import AppKit
import Darwin
import WebKit
import WebappHostCore

final class DocumentWindowController: NSWindowController, WKNavigationDelegate {
    private let configuration: WebappHostConfiguration
    private weak var hostDocument: WebappHostDocument?
    private var webView: WKWebView?
    private var runnerProcess: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var startupTimer: Timer?
    private var stdoutBuffer = ""
    private var didLoadRunnerURL = false
    private var activeDocumentURL: URL?
    private var logHandle: FileHandle?
    private var closeObserver: NSObjectProtocol?

    init(configuration: WebappHostConfiguration, document: WebappHostDocument) {
        self.configuration = configuration
        self.hostDocument = document

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.minSize = NSSize(width: 640, height: 420)

        super.init(window: window)
        self.document = document
        updateWindowDocumentIdentity()
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
        fatalError("DocumentWindowController does not support NSCoder.")
    }

    deinit {
        if let closeObserver {
            NotificationCenter.default.removeObserver(closeObserver)
        }
        stopRunner()
        closeLog()
    }

    private var documentURL: URL? {
        hostDocument?.fileURL?.standardizedFileURL
    }

    func showAndStart() {
        showWindow(nil)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        guard let documentURL else {
            showError(title: "Could Not Open Document", message: "The document does not have a file URL.")
            return
        }

        loadStatusPage(
            title: "Opening \(documentURL.lastPathComponent)",
            message: "Starting \(configuration.appName)'s bundled runner."
        )
        startRunner()
    }

    func documentURLDidChange() {
        updateWindowDocumentIdentity()

        guard let documentURL, activeDocumentURL != nil, activeDocumentURL != documentURL else {
            return
        }

        restartRunner()
    }

    func stopForAppTermination() {
        stopRunner()
        closeLog()
    }

    private func handleWindowWillClose() {
        stopRunner()
        closeLog()
    }

    private func restartRunner() {
        stopRunner()
        closeLog()
        stdoutBuffer.removeAll()
        didLoadRunnerURL = false

        guard let documentURL else {
            showError(title: "Could Not Open Document", message: "The document does not have a file URL.")
            return
        }

        loadStatusPage(
            title: "Opening \(documentURL.lastPathComponent)",
            message: "Restarting \(configuration.appName)'s bundled runner."
        )
        startRunner()
    }

    private func updateWindowDocumentIdentity() {
        guard let documentURL else {
            window?.representedURL = nil
            window?.title = "Untitled"
            return
        }

        window?.representedURL = documentURL
        window?.setTitleWithRepresentedFilename(documentURL.path)
    }

    private func startRunner() {
        do {
            guard let documentURL else {
                throw WebappHostError.invalidInfoPlist("The document does not have a file URL.")
            }

            let bunURL = try BunResolver().resolve()
            let command = try RunnerCommandBuilder.command(
                bunURL: bunURL,
                configuration: configuration,
                documentURL: documentURL
            )

            try openLog()
            writeLog("\(configuration.appName) opening \(documentURL.path)\n")
            writeLog("Runner cwd: \(command.currentDirectoryURL.path)\n")
            writeLog("Runner: \(command.executableURL.path) \(command.arguments.joined(separator: " "))\n")

            let stdout = Pipe()
            let stderr = Pipe()
            let process = Process()
            stdoutPipe = stdout
            stderrPipe = stderr
            process.executableURL = command.executableURL
            process.arguments = command.arguments
            process.currentDirectoryURL = command.currentDirectoryURL
            process.environment = runnerEnvironment()
            process.standardOutput = stdout
            process.standardError = stderr

            stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else {
                    return
                }
                DispatchQueue.main.async { [weak self] in
                    self?.handleStdout(data)
                }
            }

            stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else {
                    return
                }
                DispatchQueue.main.async { [weak self] in
                    self?.handleStderr(data)
                }
            }

            process.terminationHandler = { [weak self] process in
                DispatchQueue.main.async { [weak self] in
                    self?.handleRunnerTermination(process)
                }
            }

            runnerProcess = process
            activeDocumentURL = documentURL
            try process.run()
            startupTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
                DispatchQueue.main.async { [weak self] in
                    self?.handleStartupTimeout()
                }
            }
        } catch {
            runnerProcess = nil
            detachProcessPipes()
            activeDocumentURL = nil
            showError(title: "Could Not Open Document", message: String(describing: error))
            writeLog("ERROR: \(String(describing: error))\n")
        }
    }

    private func runnerEnvironment() -> [String: String] {
        guard let documentURL else {
            return ProcessInfo.processInfo.environment
        }

        var environment = ProcessInfo.processInfo.environment
        environment["WEBAPP_HOST_BUNDLE_ID"] = configuration.bundleIdentifier
        environment["WEBAPP_HOST_APP_NAME"] = configuration.appName
        environment["WEBAPP_HOST_DOCUMENT_PATH"] = documentURL.path
        environment["WEBAPP_HOST_DOCUMENT_KIND"] = configuration.documentKindEnvironmentValue
        environment["WEBAPP_HOST_BUNDLE_PATH"] = configuration.bundleURL.path
        environment["WEBAPP_HOST_RUNNER_DIR"] = configuration.runnerDirectoryURL.path
        return environment
    }

    private func handleStdout(_ data: Data) {
        let text = String(decoding: data, as: UTF8.self)
        writeLog(text)
        stdoutBuffer.append(text)

        while let newline = stdoutBuffer.firstIndex(where: \.isNewline) {
            let line = String(stdoutBuffer[..<newline])
            stdoutBuffer.removeSubrange(...newline)
            handleRunnerLine(line)
        }
    }

    private func handleStderr(_ data: Data) {
        writeLog(String(decoding: data, as: UTF8.self))
    }

    private func handleRunnerLine(_ line: String) {
        guard let openURL = WebappHostOpenURL.extract(from: line) else {
            return
        }

        do {
            guard let documentURL else {
                throw WebappHostError.invalidOpenURL("The document does not have a file URL.")
            }

            let safeURL = try WebappHostOpenURL.validate(
                openURL,
                documentURL: documentURL,
                bundleURL: configuration.bundleURL
            )
            didLoadRunnerURL = true
            startupTimer?.invalidate()
            startupTimer = nil
            loadWebView(url: safeURL)
        } catch {
            showError(title: "Runner URL Was Rejected", message: String(describing: error))
            stopRunner()
        }
    }

    private func handleRunnerTermination(_ process: Process) {
        stdoutBuffer.removeAll()
        startupTimer?.invalidate()
        startupTimer = nil

        guard runnerProcess === process else {
            return
        }

        runnerProcess = nil
        detachProcessPipes()
        activeDocumentURL = nil

        if !didLoadRunnerURL {
            showError(
                title: "Runner Exited Before Opening",
                message: "The bundled runner exited with status \(process.terminationStatus) before printing a loopback HTTP(S) URL or bundle/document-local file:// URL."
            )
        }
    }

    private func handleStartupTimeout() {
        guard !didLoadRunnerURL else {
            return
        }

        showError(
            title: "Runner Timed Out",
            message: "The bundled runner did not print a loadable URL within 20 seconds."
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
        activeDocumentURL = nil

        guard process.isRunning else {
            return
        }

        process.terminate()
        let pid = process.processIdentifier
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
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

    private func openLog() throws {
        guard let documentURL else {
            return
        }

        let logsDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs", isDirectory: true)
            .appendingPathComponent(configuration.logName, isDirectory: true)
        try FileManager.default.createDirectory(at: logsDirectory, withIntermediateDirectories: true)

        let timestamp = ISO8601DateFormatter()
            .string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
        let baseName = documentURL.deletingPathExtension().lastPathComponent
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
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 760),
        ])

        window?.contentView = container
    }

    private func loadWebView(url: URL) {
        let webView = WKWebView(frame: window?.contentView?.bounds ?? .zero)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        self.webView = webView
        window?.contentView = webView
        window?.initialFirstResponder = webView
        window?.makeFirstResponder(webView)
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        window?.makeFirstResponder(webView)
    }
}
