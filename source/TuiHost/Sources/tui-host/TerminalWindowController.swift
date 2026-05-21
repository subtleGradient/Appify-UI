import AppKit
import Darwin
import Security
import TuiHostCore
import WebKit

final class TerminalWindowController: NSWindowController, WKNavigationDelegate {
    var onClose: (() -> Void)?

    private let configuration: TuiHostConfiguration
    private let packageURL: URL
    private let workingDirectory: URL?
    private var webView: WKWebView?
    private var runnerProcess: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var startupTimer: Timer?
    private var stdoutBuffer = ""
    private var stderrBuffer = ""
    private var didLoadTerminal = false
    private var isClosing = false
    private var closeObserver: NSObjectProtocol?
    private var logHandle: FileHandle?
    private var terminalURL: URL?
    private var expectedPort: Int?
    private var terminalBasePath: String?

    init(configuration: TuiHostConfiguration, packageURL: URL) {
        self.configuration = configuration
        self.packageURL = packageURL.standardizedFileURL
        self.workingDirectory = try? PackageDocument.workingDirectory(forPackage: packageURL, configuration: configuration)

        let title = workingDirectory?.lastPathComponent.nonEmpty ?? packageURL.deletingPathExtension().lastPathComponent
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1080, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "\(configuration.windowTitlePrefix) - \(title)"
        window.minSize = NSSize(width: 720, height: 480)

        super.init(window: window)
        closeObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification,
            object: window,
            queue: .main
        ) { [weak self] _ in
            DispatchQueue.main.async { [weak self] in
                self?.handleWindowWillClose()
            }
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("TerminalWindowController does not support NSCoder.")
    }

    deinit {
        if let closeObserver {
            NotificationCenter.default.removeObserver(closeObserver)
        }
    }

    func showAndStart() {
        showWindow(nil)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        loadStatusPage(
            title: "Opening \(configuration.appName)",
            message: "Starting a local ttyd terminal for \(packageURL.lastPathComponent)."
        )
        startRunner()
    }

    private func handleWindowWillClose() {
        isClosing = true
        stopRunner()
        closeLog()
        onClose?()
    }

    private func startRunner() {
        do {
            let workingDirectory = try PackageDocument.workingDirectory(forPackage: packageURL, configuration: configuration)
            let port = try allocateLoopbackPort()
            let basePath = try makeTerminalBasePath()
            let mode = try TerminalToolResolver().resolve(configuration: configuration)
            let request = TerminalRunnerRequest(
                documentURL: packageURL,
                workingDirectory: workingDirectory,
                port: port,
                basePath: basePath
            )
            let command = TerminalCommandBuilder.command(
                mode: mode,
                configuration: configuration,
                request: request
            )
            let url = TerminalURLValidator.terminalURL(port: port, basePath: basePath)

            self.expectedPort = port
            self.terminalBasePath = basePath
            self.terminalURL = url

            try openLog()
            writeLog("\(configuration.appName) opening \(packageURL.path)\n")
            writeLog("Working directory: \(workingDirectory.path)\n")
            writeLog("Runner: \(command.executableURL.path) \(command.redactedArguments.joined(separator: " "))\n")

            let stdout = Pipe()
            let stderr = Pipe()
            let process = Process()
            stdoutPipe = stdout
            stderrPipe = stderr
            process.executableURL = command.executableURL
            process.arguments = command.arguments
            process.currentDirectoryURL = workingDirectory
            process.environment = runnerEnvironment(command: command)
            process.standardOutput = stdout
            process.standardError = stderr

            stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else {
                    return
                }
                DispatchQueue.main.async { [weak self] in
                    self?.handleProcessOutput(data, isStdout: true)
                }
            }

            stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else {
                    return
                }
                DispatchQueue.main.async { [weak self] in
                    self?.handleProcessOutput(data, isStdout: false)
                }
            }

            process.terminationHandler = { [weak self] process in
                DispatchQueue.main.async { [weak self] in
                    self?.handleRunnerTermination(process)
                }
            }

            runnerProcess = process
            try process.run()
            startupTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
                DispatchQueue.main.async { [weak self] in
                    self?.handleStartupTimeout()
                }
            }
        } catch {
            runnerProcess = nil
            detachProcessPipes()
            showError(title: "Could Not Open \(configuration.appName)", message: String(describing: error))
            writeLog("ERROR: \(String(describing: error))\n")
        }
    }

    private func runnerEnvironment(command: RunnerCommand) -> [String: String] {
        let templateValues = TemplateValues(
            documentURL: packageURL,
            workingDirectory: workingDirectory ?? packageURL.deletingLastPathComponent()
        )
        var additional = TemplateExpander.expand(
            configuration.environmentVariables,
            templateValues: templateValues
        )
        additional["TUI_HOST_BUNDLE_ID"] = configuration.bundleIdentifier
        additional["TUI_HOST_APP_NAME"] = configuration.appName
        additional["TUI_HOST_DOCUMENT_PATH"] = packageURL.path
        additional["TUI_HOST_WORKING_DIRECTORY"] = templateValues.workingDirectory.path
        additional["TUI_HOST_BUNDLE_PATH"] = configuration.bundleURL.path

        return RunnerEnvironmentBuilder.build(
            base: ProcessInfo.processInfo.environment,
            pathPrefixes: command.pathPrefixes,
            additional: additional
        )
    }

    private func handleProcessOutput(_ data: Data, isStdout: Bool) {
        let text = String(decoding: data, as: UTF8.self)
        writeLog(redactForLog(text))

        if isStdout {
            stdoutBuffer.append(text)
            drainLines(from: &stdoutBuffer)
        } else {
            stderrBuffer.append(text)
            drainLines(from: &stderrBuffer)
        }
    }

    private func drainLines(from buffer: inout String) {
        while let newline = buffer.firstIndex(where: \.isNewline) {
            let line = String(buffer[..<newline])
            buffer.removeSubrange(...newline)
            handleRunnerLine(line)
        }
    }

    private func handleRunnerLine(_ line: String) {
        guard let expectedPort, TerminalReadyLineDetector.isReadyLine(line, port: expectedPort) else {
            return
        }
        loadTerminalIfReady()
    }

    private func loadTerminalIfReady() {
        guard !didLoadTerminal, let terminalURL else {
            return
        }
        didLoadTerminal = true
        startupTimer?.invalidate()
        startupTimer = nil
        loadWebView(url: terminalURL)
    }

    private func handleRunnerTermination(_ process: Process) {
        startupTimer?.invalidate()
        startupTimer = nil

        guard runnerProcess === process else {
            return
        }

        runnerProcess = nil
        detachProcessPipes()

        guard !isClosing, !didLoadTerminal else {
            return
        }

        showError(
            title: "\(configuration.appName) Terminal Exited",
            message: "The local ttyd terminal exited with status \(process.terminationStatus) before the webview could connect."
        )
    }

    private func handleStartupTimeout() {
        guard !didLoadTerminal else {
            return
        }

        showError(
            title: "\(configuration.appName) Terminal Timed Out",
            message: "The local ttyd terminal did not become reachable on 127.0.0.1 within 20 seconds."
        )
        stopRunner()
    }

    private func stopRunner() {
        startupTimer?.invalidate()
        startupTimer = nil

        guard let process = runnerProcess else {
            return
        }
        runnerProcess = nil
        detachProcessPipes()

        guard process.isRunning else {
            return
        }

        let pid = process.processIdentifier
        let descendantPIDs = currentDescendantPIDs(rootPID: pid)
        sendSignal(SIGTERM, toDescendants: descendantPIDs)
        process.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            let latestDescendantPIDs = currentDescendantPIDs(rootPID: pid)
            sendSignal(SIGKILL, toDescendants: uniquePIDs(descendantPIDs + latestDescendantPIDs))
            if process.isRunning {
                kill(pid, SIGKILL)
            }
        }
    }

    private func detachProcessPipes() {
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        stdoutPipe = nil
        stderrPipe = nil
    }

    private func loadWebView(url: URL) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false

        let webView = WKWebView(frame: window?.contentView?.bounds ?? .zero, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        self.webView = webView
        window?.contentView = webView
        webView.load(URLRequest(url: url))
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.absoluteString == "about:blank" {
            decisionHandler(.allow)
            return
        }
        guard let expectedPort,
              let terminalBasePath,
              TerminalURLValidator.isAllowed(url, expectedPort: expectedPort, expectedBasePath: terminalBasePath)
        else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    private func openLog() throws {
        let logsDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs", isDirectory: true)
            .appendingPathComponent(configuration.logName, isDirectory: true)
        try FileManager.default.createDirectory(at: logsDirectory, withIntermediateDirectories: true)

        let timestamp = ISO8601DateFormatter()
            .string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
        let baseName = packageURL.deletingPathExtension().lastPathComponent
        let logURL = logsDirectory.appendingPathComponent("\(baseName)-\(timestamp).log")
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        logHandle = try FileHandle(forWritingTo: logURL)
    }

    private func writeLog(_ text: String) {
        guard let data = text.data(using: .utf8) else {
            return
        }
        logHandle?.write(data)
    }

    private func redactForLog(_ text: String) -> String {
        guard let terminalBasePath else {
            return text
        }
        return text.replacingOccurrences(of: terminalBasePath, with: "/<redacted>")
    }

    private func closeLog() {
        try? logHandle?.close()
        logHandle = nil
    }

    private func loadStatusPage(title: String, message: String) {
        showMessage(title: title, message: message, accent: NSColor.systemBlue)
    }

    private func showError(title: String, message: String) {
        showMessage(title: title, message: message, accent: NSColor.systemRed)
    }

    private func showMessage(title: String, message: String, accent: NSColor) {
        webView = nil

        let container = NSView()
        container.translatesAutoresizingMaskIntoConstraints = false

        let accentBar = NSView()
        accentBar.wantsLayer = true
        accentBar.layer?.backgroundColor = accent.cgColor
        accentBar.translatesAutoresizingMaskIntoConstraints = false

        let titleLabel = NSTextField(labelWithString: title)
        titleLabel.font = NSFont.systemFont(ofSize: 24, weight: .semibold)
        titleLabel.lineBreakMode = .byWordWrapping
        titleLabel.maximumNumberOfLines = 0
        titleLabel.translatesAutoresizingMaskIntoConstraints = false

        let messageLabel = NSTextField(labelWithString: message)
        messageLabel.font = NSFont.systemFont(ofSize: 14)
        messageLabel.textColor = NSColor.secondaryLabelColor
        messageLabel.lineBreakMode = .byWordWrapping
        messageLabel.maximumNumberOfLines = 0
        messageLabel.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView(views: [titleLabel, messageLabel])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(accentBar)
        container.addSubview(stack)

        NSLayoutConstraint.activate([
            accentBar.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 32),
            accentBar.topAnchor.constraint(equalTo: stack.topAnchor, constant: 2),
            accentBar.widthAnchor.constraint(equalToConstant: 4),
            accentBar.heightAnchor.constraint(equalTo: stack.heightAnchor),

            stack.leadingAnchor.constraint(equalTo: accentBar.trailingAnchor, constant: 20),
            stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -32),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 720),
        ])

        window?.contentView = container
    }
}

private func allocateLoopbackPort() throws -> Int {
    let descriptor = socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    defer {
        close(descriptor)
    }

    var address = sockaddr_in()
    address.sin_len = __uint8_t(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = 0
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

    let bindResult = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
            bind(descriptor, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    guard bindResult == 0 else {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }

    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    let nameResult = withUnsafeMutablePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
            getsockname(descriptor, sockaddrPointer, &length)
        }
    }
    guard nameResult == 0 else {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }

    return Int(UInt16(bigEndian: address.sin_port))
}

private func makeTerminalBasePath() throws -> String {
    "/tui-host-\(try randomHex(byteCount: 18))"
}

private func randomHex(byteCount: Int) throws -> String {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    guard status == errSecSuccess else {
        throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
    return bytes.map { String(format: "%02x", $0) }.joined()
}

private func currentDescendantPIDs(rootPID: pid_t) -> [pid_t] {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/ps")
    process.arguments = ["-axo", "pid=,ppid="]

    let stdout = Pipe()
    process.standardOutput = stdout
    process.standardError = Pipe()

    do {
        try process.run()
        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            return []
        }
        let output = String(decoding: data, as: UTF8.self)
        let entries = ProcessTree.parsePSOutput(output)
        return ProcessTree.descendantPIDs(rootPID: rootPID, entries: entries)
    } catch {
        return []
    }
}

private func sendSignal(_ signal: Int32, toDescendants pids: [pid_t]) {
    for pid in pids {
        kill(pid, signal)
    }
}

private func uniquePIDs(_ pids: [pid_t]) -> [pid_t] {
    var seen = Set<pid_t>()
    var result: [pid_t] = []
    for pid in pids where !seen.contains(pid) {
        seen.insert(pid)
        result.append(pid)
    }
    return result
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
