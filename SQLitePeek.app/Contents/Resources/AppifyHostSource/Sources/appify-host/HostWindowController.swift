import AppKit
import AppifyHostCore
import Darwin
import WebKit

final class HostWindowController: NSWindowController, WKNavigationDelegate {
    private let configuration: AppifyHostConfiguration
    private weak var hostDocument: AppifyHostDocument?
    private var webView: WKWebView?
    private var serverProcess: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var startupTimer: Timer?
    private var stdoutBuffer = ""
    private var activeDocumentURL: URL?
    private var activeReadyURL: URL?
    private var didLoadServerURL = false
    private var isClosing = false
    private var logHandle: FileHandle?
    private var closeObserver: NSObjectProtocol?

    init(configuration: AppifyHostConfiguration, document: AppifyHostDocument) {
        self.configuration = configuration
        self.hostDocument = document

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.minSize = NSSize(width: 640, height: 420)
        window.isRestorable = false

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
        fatalError("HostWindowController does not support NSCoder.")
    }

    deinit {
        if let closeObserver {
            NotificationCenter.default.removeObserver(closeObserver)
        }
        stopServer()
        closeLog()
    }

    func showAndStart(documentURL: URL) {
        activeDocumentURL = documentURL.standardizedFileURL
        updateWindowDocumentIdentity()
        showWindow(nil)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        loadStatusPage(
            title: "Opening \(documentURL.lastPathComponent)",
            message: "Starting \(configuration.appName)'s app-local server."
        )
        startServer()
    }

    func documentURLDidChange() {
        updateWindowDocumentIdentity()

        guard let nextURL = hostDocument?.activeDocumentURL?.standardizedFileURL,
              activeDocumentURL != nil,
              activeDocumentURL != nextURL
        else {
            return
        }

        activeDocumentURL = nextURL
        restartServer()
    }

    func stopForAppTermination() {
        stopServer()
        closeLog()
    }

    private func handleWindowWillClose() {
        isClosing = true
        stopServer()
        closeLog()
    }

    private func restartServer() {
        stopServer()
        closeLog()
        stdoutBuffer.removeAll()
        activeReadyURL = nil
        didLoadServerURL = false

        guard let activeDocumentURL else {
            showError(title: "Could Not Open Document", message: "The document does not have a file URL.")
            return
        }

        loadStatusPage(
            title: "Opening \(activeDocumentURL.lastPathComponent)",
            message: "Restarting \(configuration.appName)'s app-local server."
        )
        startServer()
    }

    private func updateWindowDocumentIdentity() {
        guard let documentURL = hostDocument?.activeDocumentURL ?? activeDocumentURL else {
            window?.representedURL = nil
            window?.title = "Untitled"
            return
        }

        switch configuration.documentMode {
        case .contentPackage:
            window?.representedURL = hostDocument?.fileURL
            if hostDocument?.fileURL == nil {
                window?.title = "Untitled"
            } else {
                window?.setTitleWithRepresentedFilename(documentURL.path)
            }

        case .folderMarker:
            let title = (try? PackageDocument.workingDirectory(forPackage: documentURL, configuration: configuration).lastPathComponent)
                ?? documentURL.deletingPathExtension().lastPathComponent
            window?.representedURL = documentURL
            window?.title = "\(configuration.windowTitlePrefix) - \(title)"

        case .fileDocument:
            window?.representedURL = documentURL
            window?.title = "\(configuration.windowTitlePrefix) - \(documentURL.lastPathComponent)"
        }
    }

    private func startServer() {
        do {
            guard let documentURL = activeDocumentURL else {
                throw AppifyHostError.invalidInfoPlist("The document does not have a file URL.")
            }

            let workingDirectory = try PackageDocument.workingDirectory(forPackage: documentURL, configuration: configuration)
            let templateValues = TemplateValues(
                bundleURL: configuration.bundleURL,
                documentURL: documentURL,
                workingDirectory: workingDirectory
            )
            let command = try ServerCommandBuilder.command(configuration: configuration, templateValues: templateValues)

            try openLog(documentURL: documentURL)
            writeLog("\(configuration.appName) opening \(documentURL.path)\n")
            writeLog("Working directory: \(workingDirectory.path)\n")
            writeLog("Server cwd: \(command.currentDirectoryURL.path)\n")
            writeLog("Server: \(command.executableURL.path) \(command.arguments.joined(separator: " "))\n")

            let stdout = Pipe()
            let stderr = Pipe()
            let process = Process()
            stdoutPipe = stdout
            stderrPipe = stderr
            process.executableURL = command.executableURL
            process.arguments = command.arguments
            process.currentDirectoryURL = command.currentDirectoryURL
            process.environment = serverEnvironment(templateValues: templateValues)
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
                    self?.handleServerTermination(process)
                }
            }

            serverProcess = process
            try process.run()
            startupTimer = Timer.scheduledTimer(withTimeInterval: configuration.startupTimeoutSeconds, repeats: false) { [weak self] _ in
                DispatchQueue.main.async { [weak self] in
                    self?.handleStartupTimeout()
                }
            }
        } catch {
            serverProcess = nil
            detachProcessPipes()
            showError(title: "Could Not Open \(configuration.appName)", message: String(describing: error))
            writeLog("ERROR: \(String(describing: error))\n")
        }
    }

    private func serverEnvironment(templateValues: TemplateValues) -> [String: String] {
        var additional = TemplateExpander.expand(
            configuration.environmentVariables,
            templateValues: templateValues
        )
        additional["APPIFY_HOST_BUNDLE_ID"] = configuration.bundleIdentifier
        additional["APPIFY_HOST_APP_NAME"] = configuration.appName
        additional["APPIFY_HOST_DOCUMENT_PATH"] = templateValues.documentURL.path
        additional["APPIFY_HOST_WORKING_DIRECTORY"] = templateValues.workingDirectory.path
        additional["APPIFY_HOST_DOCUMENT_KIND"] = configuration.documentKindEnvironmentValue
        additional["APPIFY_HOST_BUNDLE_PATH"] = configuration.bundleURL.path
        additional["APPIFY_HOST_SERVER_DIR"] = configuration.serverDirectoryURL.path

        return ServerEnvironmentBuilder.build(
            base: ProcessInfo.processInfo.environment,
            additional: additional
        )
    }

    private func handleStdout(_ data: Data) {
        let text = String(decoding: data, as: UTF8.self)
        writeLog(text)
        stdoutBuffer.append(text)

        while let newline = stdoutBuffer.firstIndex(where: \.isNewline) {
            let line = String(stdoutBuffer[..<newline])
            stdoutBuffer.removeSubrange(...newline)
            handleServerLine(line)
        }
    }

    private func handleStderr(_ data: Data) {
        writeLog(String(decoding: data, as: UTF8.self))
    }

    private func handleServerLine(_ line: String) {
        guard let openURL = AppifyHostOpenURL.extract(from: line) else {
            return
        }

        do {
            guard let activeDocumentURL else {
                throw AppifyHostError.invalidOpenURL("The document does not have a file URL.")
            }

            let safeURL = try AppifyHostOpenURL.validateReadyURL(
                openURL,
                documentURL: activeDocumentURL,
                bundleURL: configuration.bundleURL
            )
            activeReadyURL = safeURL
            didLoadServerURL = true
            startupTimer?.invalidate()
            startupTimer = nil
            loadWebView(url: safeURL)
        } catch {
            showError(title: "Server URL Was Rejected", message: String(describing: error))
            stopServer()
        }
    }

    private func handleServerTermination(_ process: Process) {
        stdoutBuffer.removeAll()
        startupTimer?.invalidate()
        startupTimer = nil

        guard serverProcess === process else {
            return
        }

        serverProcess = nil
        detachProcessPipes()

        guard !isClosing, !didLoadServerURL else {
            return
        }

        showError(
            title: "\(configuration.appName) Server Exited",
            message: "The app-local server exited with status \(process.terminationStatus) before printing APPIFY_HOST_OPEN_URL."
        )
    }

    private func handleStartupTimeout() {
        guard !didLoadServerURL else {
            return
        }

        showError(
            title: "\(configuration.appName) Server Timed Out",
            message: "The app-local server did not print APPIFY_HOST_OPEN_URL within \(startupTimeoutDescription)."
        )
        stopServer()
    }

    private var startupTimeoutDescription: String {
        let timeout = configuration.startupTimeoutSeconds
        let rounded = timeout.rounded(.towardZero)
        if timeout == rounded {
            return "\(Int(rounded)) seconds"
        }
        return "\(timeout) seconds"
    }

    private func stopServer() {
        startupTimer?.invalidate()
        startupTimer = nil

        guard let process = serverProcess else {
            return
        }
        serverProcess = nil
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

    private func openLog(documentURL: URL) throws {
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
        let webViewConfiguration = WKWebViewConfiguration()
        if configuration.webViewDataStore == .nonPersistent {
            webViewConfiguration.websiteDataStore = .nonPersistent()
        }
        webViewConfiguration.preferences.javaScriptCanOpenWindowsAutomatically = false

        let webView = WKWebView(frame: window?.contentView?.bounds ?? .zero, configuration: webViewConfiguration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        self.webView = webView
        window?.contentView = webView
        window?.initialFirstResponder = webView
        window?.makeFirstResponder(webView)
        webView.load(URLRequest(url: url))
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url,
              let activeReadyURL,
              let activeDocumentURL
        else {
            decisionHandler(.cancel)
            return
        }

        let allowed = AppifyHostOpenURL.isAllowedNavigation(
            url,
            readyURL: activeReadyURL,
            documentURL: activeDocumentURL,
            bundleURL: configuration.bundleURL,
            restrictToReadyURLScope: configuration.restrictNavigationToReadyURLScope
        )
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        window?.makeFirstResponder(webView)
    }
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
