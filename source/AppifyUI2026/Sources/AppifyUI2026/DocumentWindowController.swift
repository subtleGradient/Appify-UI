import AppifyUI2026Core
import AppKit
import Darwin
import WebKit

@MainActor
final class DocumentWindowController: NSWindowController, NSWindowDelegate {
    var onClose: (() -> Void)?

    private let documentURL: URL
    private var webView: WKWebView?
    private var runnerProcess: Process?
    private var startupTimer: Timer?
    private var stdoutBuffer = ""
    private var didLoadRunnerURL = false
    private var logHandle: FileHandle?

    init(documentURL: URL) {
        self.documentURL = documentURL.standardizedFileURL

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1080, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = documentURL.deletingPathExtension().lastPathComponent
        window.minSize = NSSize(width: 520, height: 360)

        super.init(window: window)
        window.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("DocumentWindowController does not support NSCoder.")
    }

    func showAndStart() {
        showWindow(nil)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        loadStatusPage(title: "Opening \(documentURL.lastPathComponent)", message: "Validating webapp.json and starting the trusted runner.")
        startRunner()
    }

    func windowWillClose(_ notification: Notification) {
        stopRunner()
        closeLog()
        onClose?()
    }

    private func startRunner() {
        do {
            let manifest = try WebappManifestLoader.load(from: documentURL)
            let bunURL = try BunResolver().resolve()
            let command = try RunnerCommandBuilder.command(
                bunURL: bunURL,
                manifest: manifest,
                documentURL: documentURL
            )

            try openLog()
            writeLog("Appify UI opening \(documentURL.path)\n")
            writeLog("Runner: \(command.executableURL.path) \(command.arguments.joined(separator: " "))\n")

            let stdout = Pipe()
            let stderr = Pipe()
            let process = Process()
            process.executableURL = command.executableURL
            process.arguments = command.arguments
            process.currentDirectoryURL = documentURL
            process.environment = runnerEnvironment()
            process.standardOutput = stdout
            process.standardError = stderr

            stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else {
                    return
                }
                Task { @MainActor [weak self] in
                    self?.handleStdout(data)
                }
            }

            stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else {
                    return
                }
                Task { @MainActor [weak self] in
                    self?.handleStderr(data)
                }
            }

            process.terminationHandler = { [weak self] process in
                Task { @MainActor [weak self] in
                    self?.handleRunnerTermination(process)
                }
            }

            runnerProcess = process
            try process.run()
            startupTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.handleStartupTimeout()
                }
            }
        } catch {
            showError(title: "Could Not Open Web App", message: String(describing: error))
            writeLog("ERROR: \(String(describing: error))\n")
        }
    }

    private func runnerEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["APPIFY_DOCUMENT"] = documentURL.path
        environment["APPIFY_DOCUMENT_KIND"] = "appify.webapp"
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
        guard let openURL = AppifyOpenURL.extract(from: line) else {
            return
        }

        do {
            let safeURL = try AppifyOpenURL.validate(openURL, documentURL: documentURL)
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
        process.standardOutput = nil
        process.standardError = nil

        if !didLoadRunnerURL {
            showError(
                title: "Runner Exited Before Opening",
                message: "The trusted runner exited with status \(process.terminationStatus) before printing \(AppifyOpenURL.outputPrefix)<url>."
            )
        }
    }

    private func handleStartupTimeout() {
        guard !didLoadRunnerURL else {
            return
        }

        showError(
            title: "Runner Timed Out",
            message: "The trusted runner did not print \(AppifyOpenURL.outputPrefix)<url> within 20 seconds."
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
        process.standardOutput = nil
        process.standardError = nil

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

    private func openLog() throws {
        let logsDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Appify-UI", isDirectory: true)
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
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 720),
        ])

        window?.contentView = container
    }

    private func loadWebView(url: URL) {
        let webView = WKWebView(frame: window?.contentView?.bounds ?? .zero)
        webView.autoresizingMask = [.width, .height]
        self.webView = webView
        window?.contentView = webView
        webView.load(URLRequest(url: url))
    }
}
