import AppKit
import AppifyHostCore
import Darwin
import WebKit

final class HostWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    private let configuration: AppifyHostConfiguration
    private var hostDocument: AppifyHostDocument?
    private var webView: WKWebView?
    private var serverProcess: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var startupTimer: Timer?
    private var stdoutBuffer = ""
    private var activeDocumentURL: URL?
    private var activeReadyURL: URL?
    private var pendingDeepLinkRoute: String?
    private var didLoadServerURL = false
    private var isClosing = false
    private var allowNextWindowClose = false
    private var closeValidationInProgress = false
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
        window.isReleasedWhenClosed = false
        window.isRestorable = false

        super.init(window: window)
        window.delegate = self
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

    func showAndStart(documentURL: URL, initialRoute: String? = nil) {
        activeDocumentURL = resolvedDocumentURL(documentURL)
        pendingDeepLinkRoute = initialRoute
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

    func navigate(toDeepLinkRoute route: String) {
        guard let activeReadyURL,
              let activeDocumentURL,
              let webView
        else {
            pendingDeepLinkRoute = route
            return
        }

        do {
            let routedURL = try AppifyHostOpenURL.readyURL(activeReadyURL, routedTo: route)
            guard AppifyHostOpenURL.isAllowedNavigation(
                routedURL,
                readyURL: activeReadyURL,
                documentURL: activeDocumentURL,
                bundleURL: configuration.bundleURL,
                restrictToReadyURLScope: configuration.restrictNavigationToReadyURLScope
            )
            else {
                throw AppifyHostError.invalidOpenURL("Deep link route leaves the app-local server scope.")
            }

            webView.load(URLRequest(url: routedURL))
        } catch {
            showError(title: "Deep Link Was Rejected", message: String(describing: error))
            writeLog("WARN: deep link route rejected: \(String(describing: error))\n")
        }
    }

    func documentURLDidChange() {
        updateWindowDocumentIdentity()

        guard let nextDocumentURL = hostDocument?.activeDocumentURL,
              activeDocumentURL != nil
        else {
            return
        }

        let nextURL = resolvedDocumentURL(nextDocumentURL)
        guard activeDocumentURL != nextURL else {
            return
        }

        activeDocumentURL = nextURL
        restartServer()
    }

    func stopForAppTermination() {
        stopServer()
        closeLog()
    }

    func flushWebDocumentSave(completion: @escaping (Result<Void, Error>) -> Void) {
        guard let webView, didLoadServerURL else {
            completion(.success(()))
            return
        }

        webView.callAsyncJavaScript(
            """
            const hook = window.AppifyHost && window.AppifyHost.save;
            if (typeof hook !== "function") {
              return { handled: false, ok: true };
            }

            const result = await hook();
            if (result === false) {
              return { handled: true, ok: false, message: "The web document refused to save." };
            }
            if (result && typeof result === "object" && result.ok === false) {
              return { handled: true, ok: false, message: String(result.message || "The web document refused to save.") };
            }
            return { handled: true, ok: true };
            """,
            arguments: [:],
            in: nil,
            in: .page
        ) { [weak self] result in
            switch result {
            case .success(let value):
                let dictionary = value as? [String: Any] ?? [:]
                let ok = boolValue(dictionary["ok"], defaultValue: true)
                if ok {
                    completion(.success(()))
                    return
                }

                let message = dictionary["message"] as? String ?? "The web document could not be saved."
                completion(.failure(webDocumentSaveError(message)))

            case .failure(let error):
                self?.writeLog("WARN: web document save hook failed: \(String(describing: error))\n")
                completion(.failure(error))
            }
        }
    }

    private func handleWindowWillClose() {
        isClosing = true
        stopServer()
        closeLog()
        DispatchQueue.main.async { [weak self] in
            self?.document = nil
            self?.hostDocument = nil
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if isClosing || allowNextWindowClose {
            allowNextWindowClose = false
            isClosing = true
            return true
        }

        guard webView != nil, didLoadServerURL else {
            isClosing = true
            return true
        }

        guard !closeValidationInProgress else {
            return false
        }

        closeValidationInProgress = true
        waitForCleanWebState(deadline: Date().addingTimeInterval(5.0)) { [weak self, weak sender] result in
            guard let self else {
                return
            }

            self.closeValidationInProgress = false
            switch result {
            case .clean:
                self.allowNextWindowClose = true
                sender?.performClose(nil)

            case .dirty(let detail):
                self.showUnsyncedCloseAlert(detail: detail, window: sender)
            }
        }

        return false
    }

    private enum CloseValidationResult {
        case clean
        case dirty(String)
    }

    private struct WebDirtyState {
        var dirty: Bool
        var detail: String
    }

    private func waitForCleanWebState(deadline: Date, completion: @escaping (CloseValidationResult) -> Void) {
        readWebDirtyState { [weak self] state in
            guard let self else {
                return
            }

            if !state.dirty {
                completion(.clean)
                return
            }

            if Date() < deadline {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                    self?.waitForCleanWebState(deadline: deadline, completion: completion)
                }
                return
            }

            completion(.dirty(state.detail))
        }
    }

    private func readWebDirtyState(completion: @escaping (WebDirtyState) -> Void) {
        guard let webView else {
            completion(WebDirtyState(dirty: false, detail: "The web view is no longer loaded."))
            return
        }

        webView.evaluateJavaScript(
            """
            (() => {
              const tw = window.$tw;
              const syncer = tw && tw.syncer;
              const saver = tw && tw.saverHandler;
              const appifyHost = window.AppifyHost;
              const appifyHostDirty = !!(appifyHost && typeof appifyHost.isDirty === "function" && appifyHost.isDirty());
              const syncerDirty = !!(syncer && typeof syncer.isDirty === "function" && syncer.isDirty());
              const saverDirty = !!(saver && typeof saver.isDirty === "function" && saver.isDirty());
              const bodyDirty = !!(document.body && document.body.classList.contains("tc-dirty"));
              const inProgress = Number((syncer && syncer.numTasksInProgress) || 0);
              return {
                dirty: appifyHostDirty || syncerDirty || saverDirty || bodyDirty || inProgress > 0,
                appifyHostDirty,
                syncerDirty,
                saverDirty,
                bodyDirty,
                inProgress
              };
            })();
            """
        ) { [weak self] result, error in
            if let error {
                self?.writeLog("WARN: close dirty-state check failed: \(String(describing: error))\n")
                completion(WebDirtyState(dirty: false, detail: "The dirty-state check failed."))
                return
            }

            let dictionary = result as? [String: Any] ?? [:]
            let appifyHostDirty = boolValue(dictionary["appifyHostDirty"])
            let syncerDirty = boolValue(dictionary["syncerDirty"])
            let saverDirty = boolValue(dictionary["saverDirty"])
            let bodyDirty = boolValue(dictionary["bodyDirty"])
            let inProgress = intValue(dictionary["inProgress"])
            let dirty = boolValue(dictionary["dirty"])
            let detail = "appifyHostDirty=\(appifyHostDirty), syncerDirty=\(syncerDirty), saverDirty=\(saverDirty), bodyDirty=\(bodyDirty), inProgress=\(inProgress)"
            completion(WebDirtyState(dirty: dirty, detail: detail))
        }
    }

    private func showUnsyncedCloseAlert(detail: String, window: NSWindow?) {
        writeLog("WARN: refused close with unsynced web changes: \(detail)\n")

        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "\(configuration.appName) Still Has Unsynced Changes"
        alert.informativeText = "The document is still syncing, or the web app reported unsaved changes. Keep the window open and try closing again after the save indicator clears.\n\nClosing anyway may lose recent changes."
        alert.addButton(withTitle: "Keep Open")
        alert.addButton(withTitle: "Close Anyway")

        guard let window else {
            if alert.runModal() == .alertSecondButtonReturn {
                allowNextWindowClose = true
                self.window?.performClose(nil)
            }
            return
        }

        alert.beginSheetModal(for: window) { [weak self, weak window] response in
            guard let self else {
                return
            }

            if response == .alertSecondButtonReturn {
                self.allowNextWindowClose = true
                window?.performClose(nil)
            }
        }
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
        case .contentPackage, .contentPackageOrFile:
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
            window?.representedURL = hostDocument?.fileURL
            if hostDocument?.fileURL == nil {
                window?.title = "Untitled"
            } else {
                window?.title = "\(configuration.windowTitlePrefix) - \(documentURL.lastPathComponent)"
            }
        }
    }

    private func startServer() {
        do {
            guard let requestedDocumentURL = activeDocumentURL else {
                throw AppifyHostError.invalidInfoPlist("The document does not have a file URL.")
            }

            let documentURL = try PackageDocument.documentURL(forPackage: requestedDocumentURL, configuration: configuration)
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

    private func resolvedDocumentURL(_ documentURL: URL) -> URL {
        (try? PackageDocument.resolvedURL(forPackage: documentURL)) ?? documentURL.standardizedFileURL
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
            let loadURL = try AppifyHostOpenURL.readyURL(safeURL, routedTo: pendingDeepLinkRoute)
            guard AppifyHostOpenURL.isAllowedNavigation(
                loadURL,
                readyURL: safeURL,
                documentURL: activeDocumentURL,
                bundleURL: configuration.bundleURL,
                restrictToReadyURLScope: configuration.restrictNavigationToReadyURLScope
            )
            else {
                throw AppifyHostError.invalidOpenURL("Deep link route leaves the app-local server scope.")
            }

            pendingDeepLinkRoute = nil
            activeReadyURL = safeURL
            didLoadServerURL = true
            startupTimer?.invalidate()
            startupTimer = nil
            loadWebView(url: loadURL)
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
        PrivateWebKitInspector.enableDeveloperExtras(for: webViewConfiguration.preferences)
        if configuration.webViewDataStore == .nonPersistent {
            webViewConfiguration.websiteDataStore = .nonPersistent()
        }
        webViewConfiguration.preferences.javaScriptCanOpenWindowsAutomatically = false

        let webView = WKWebView(frame: window?.contentView?.bounds ?? .zero, configuration: webViewConfiguration)
        webView.isInspectable = true
        webView.allowsMagnification = true
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        self.webView = webView
        window?.contentView = webView
        window?.initialFirstResponder = webView
        window?.makeFirstResponder(webView)
        webView.load(URLRequest(url: url))
    }

    private func scheduleWebViewResizeNudge(for webView: WKWebView) {
        for delay in [0.0, 0.1, 0.3, 0.7] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self, weak webView] in
                guard let self,
                      let webView,
                      self.webView === webView
                else {
                    return
                }

                self.dispatchWebViewResizeEvent(webView)
            }
        }
    }

    private func dispatchWebViewResizeEvent(_ webView: WKWebView) {
        webView.evaluateJavaScript(
            """
            (() => {
              window.dispatchEvent(new Event("resize"));
              window.visualViewport?.dispatchEvent(new Event("resize"));
            })();
            """
        ) { [weak self] _, error in
            if let error {
                self?.writeLog("WARN: WebView resize event failed: \(String(describing: error))\n")
            }
        }
    }

    private func openLinkedWebPackageIfPossible(_ url: URL) -> Bool {
        guard let activeReadyURL,
              let activeDocumentURL,
              sameLoopbackOrigin(url, activeReadyURL),
              let target = linkedWebPackageTarget(for: url, activeDocumentURL: activeDocumentURL)
        else {
            return false
        }

        openSiblingDocument(at: target.documentURL, route: target.route)
        return true
    }

    private func linkedWebPackageTarget(
        for url: URL,
        activeDocumentURL: URL
    ) -> (documentURL: URL, route: String)? {
        let decodedPath = url.path(percentEncoded: false)
        guard decodedPath.hasPrefix("/"),
              !decodedPath.hasPrefix("//"),
              !decodedPath.contains("\0"),
              !decodedPath.contains("\\")
        else {
            return nil
        }

        let segments = decodedPath
            .split(separator: "/", omittingEmptySubsequences: true)
            .map(String.init)
        guard !segments.isEmpty,
              !segments.contains(where: { $0 == "." || $0 == ".." }),
              let packageIndex = segments.firstIndex(where: isDocumentPackageSegment)
        else {
            return nil
        }

        do {
            let webspaceRoot = try webspaceRoot(for: activeDocumentURL)
            let packageSegments = segments.prefix(packageIndex + 1)
            let routeSegments = segments.dropFirst(packageIndex + 1)
            var documentURL = webspaceRoot
            for segment in packageSegments {
                documentURL.appendPathComponent(segment, isDirectory: true)
            }

            let validatedDocumentURL = try PackageDocument.documentURL(forPackage: documentURL, configuration: configuration)
            var route = "/\(routeSegments.joined(separator: "/"))"
            if route == "/" && decodedPath.hasSuffix("/") {
                route = "/"
            }
            if let query = url.query(percentEncoded: true), !query.isEmpty {
                route += "?\(query)"
            }
            if let fragment = url.fragment(percentEncoded: true), !fragment.isEmpty {
                route += "#\(fragment)"
            }
            return (validatedDocumentURL, try AppifyHostDeepLink.normalizeRoute(route))
        } catch {
            writeLog("WARN: linked .web package open rejected: \(String(describing: error))\n")
            return nil
        }
    }

    private func isDocumentPackageSegment(_ segment: String) -> Bool {
        let lowercased = segment.lowercased()
        return configuration.documentExtensions.contains { lowercased.hasSuffix(".\($0)") }
    }

    private func webspaceRoot(for documentURL: URL) throws -> URL {
        let activeRoot = try PackageDocument.workingDirectory(forPackage: documentURL, configuration: configuration)
        if let gitRoot = nearestProjectGitRoot(startingAt: activeRoot) {
            return gitRoot
        }
        if configuration.documentExtensions.contains(activeRoot.pathExtension.lowercased()) {
            return activeRoot.deletingLastPathComponent()
        }
        return activeRoot
    }

    private func nearestProjectGitRoot(startingAt startURL: URL) -> URL? {
        let fileManager = FileManager.default
        var cursor = startURL.standardizedFileURL
        let homeURL = fileManager.homeDirectoryForCurrentUser.standardizedFileURL

        while true {
            let gitURL = cursor.appendingPathComponent(".git")
            if fileManager.fileExists(atPath: gitURL.path) {
                if cursor.path != "/" && cursor.path != homeURL.path {
                    return cursor
                }
                return nil
            }

            let parent = cursor.deletingLastPathComponent()
            if parent.path == cursor.path {
                return nil
            }
            cursor = parent
        }
    }

    private func sameLoopbackOrigin(_ left: URL, _ right: URL) -> Bool {
        left.scheme?.lowercased() == right.scheme?.lowercased()
            && left.host(percentEncoded: false)?.lowercased() == right.host(percentEncoded: false)?.lowercased()
            && left.port == right.port
            && left.user == nil
            && left.password == nil
    }

    private func openSiblingDocument(at documentURL: URL, route: String?) {
        do {
            let validatedURL = try PackageDocument.documentURL(forPackage: documentURL, configuration: configuration)
            if let existingDocument = NSDocumentController.shared.documents.compactMap({ $0 as? AppifyHostDocument }).first(where: { document in
                document.activeDocumentURL?.standardizedFileURL == validatedURL.standardizedFileURL
            }) {
                if let route {
                    existingDocument.openDeepLinkRoute(route)
                }
                existingDocument.showWindows()
                existingDocument.windowControllers.forEach { $0.window?.makeKeyAndOrderFront(nil) }
                return
            }

            let document = AppifyHostDocument()
            try document.read(from: validatedURL, ofType: configuration.documentKindEnvironmentValue)
            document.fileType = configuration.documentKindEnvironmentValue
            document.fileURL = validatedURL
            if let modificationDate = try? validatedURL.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate {
                document.fileModificationDate = modificationDate
            }
            NSDocumentController.shared.addDocument(document)
            document.makeWindowControllers()
            if let route {
                document.openDeepLinkRoute(route)
            }
            document.showWindows()
            NSDocumentController.shared.noteNewRecentDocumentURL(validatedURL)
        } catch {
            showError(title: "Could Not Open Linked .web Package", message: String(describing: error))
        }
    }

    private func isAllowedInHostNavigation(_ url: URL) -> Bool {
        guard let activeReadyURL,
              let activeDocumentURL
        else {
            return false
        }

        return AppifyHostOpenURL.isAllowedNavigation(
            url,
            readyURL: activeReadyURL,
            documentURL: activeDocumentURL,
            bundleURL: configuration.bundleURL,
            restrictToReadyURLScope: configuration.restrictNavigationToReadyURLScope
        )
    }

    private func handleUserRequestedNavigation(to url: URL) -> Bool {
        guard let activeReadyURL,
              let activeDocumentURL
        else {
            return false
        }

        if AppifyHostDeepLink.hasAllowedScheme(url, schemes: configuration.deepLinkSchemes) {
            openExternalURL(url)
            return true
        }

        let disposition = AppifyHostOpenURL.userNavigationDisposition(
            for: url,
            readyURL: activeReadyURL,
            documentURL: activeDocumentURL,
            bundleURL: configuration.bundleURL,
            restrictToReadyURLScope: configuration.restrictNavigationToReadyURLScope
        )

        guard disposition != .allowInHost else {
            return false
        }

        if openLinkedWebPackageIfPossible(url) {
            return true
        }

        switch disposition {
        case .allowInHost:
            return false

        case .openExternally:
            openExternalURL(url)
            return true

        case .askBeforeOpeningExternally:
            if confirmExternalURLOpen(url) {
                openExternalURL(url)
            }
            return true

        case .block:
            writeLog("WARN: blocked user-requested navigation to \(url.absoluteString)\n")
            return true
        }
    }

    @discardableResult
    private func openExternalURL(_ url: URL) -> Bool {
        let opened = NSWorkspace.shared.open(url)
        if !opened {
            writeLog("WARN: macOS refused to open external URL: \(url.absoluteString)\n")
        }
        return opened
    }

    private func confirmExternalURLOpen(_ url: URL) -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Open External Link?"
        alert.informativeText = """
        \(configuration.appName) wants to open this link in another app:

        \(url.absoluteString)
        """
        alert.addButton(withTitle: "Open")
        alert.addButton(withTitle: "Cancel")
        return alert.runModal() == .alertFirstButtonReturn
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url,
              activeReadyURL != nil,
              activeDocumentURL != nil
        else {
            decisionHandler(.cancel)
            return
        }

        if navigationAction.navigationType == .linkActivated,
           handleUserRequestedNavigation(to: url)
        {
            decisionHandler(.cancel)
            return
        }

        decisionHandler(isAllowedInHostNavigation(url) ? .allow : .cancel)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard navigationAction.targetFrame == nil,
              let url = navigationAction.request.url
        else {
            return nil
        }

        if handleUserRequestedNavigation(to: url) {
            return nil
        }

        if isAllowedInHostNavigation(url) {
            webView.load(navigationAction.request)
        } else {
            writeLog("WARN: blocked new-window navigation to \(url.absoluteString)\n")
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        window?.makeFirstResponder(webView)
        scheduleWebViewResizeNudge(for: webView)
    }
}

extension HostWindowController: AppifyHostWebViewReloading {
    var canReloadWebView: Bool {
        webView != nil
    }

    func reloadWebView() {
        webView?.reload()
    }
}

extension HostWindowController: AppifyHostWebViewInspecting {
    var canOpenWebInspector: Bool {
        webView != nil
    }

    func openWebInspectorFromMenu() {
        guard let webView else {
            return
        }

        guard PrivateWebKitInspector.openWebInspector(for: webView) else {
            writeLog("WARN: private Web Inspector direct-open hook was unavailable.\n")
            showWebInspectorFallback()
            return
        }
    }
}

private enum PrivateWebKitInspector {
    static func enableDeveloperExtras(for preferences: WKPreferences) {
        let selector = NSSelectorFromString("_setDeveloperExtrasEnabled:")
        guard preferences.responds(to: selector) else {
            return
        }

        preferences.setValue(true, forKey: "developerExtrasEnabled")
    }

    static func openWebInspector(for webView: WKWebView) -> Bool {
        let inspectorSelector = NSSelectorFromString("_inspector")
        guard webView.responds(to: inspectorSelector),
              let inspector = webView.value(forKey: "_inspector") as? NSObject
        else {
            return false
        }

        let showSelector = NSSelectorFromString("show")
        guard inspector.responds(to: showSelector) else {
            return false
        }

        _ = inspector.perform(showSelector)

        let detachSelector = NSSelectorFromString("detach")
        if inspector.responds(to: detachSelector) {
            _ = inspector.perform(detachSelector)
        }

        return true
    }
}

private extension HostWindowController {
    func showWebInspectorFallback() {
        let pageDescription = webView?.url?.absoluteString ?? activeReadyURL?.absoluteString ?? "the current page"
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "Open Safari Web Inspector"
        alert.informativeText = """
        This WebKit build did not expose the private direct inspector hook.

        In Safari, enable Settings > Advanced > Show features for web developers, then choose Develop > This Mac > \(configuration.appName) > \(pageDescription).
        """
        alert.addButton(withTitle: "OK")

        guard let window else {
            alert.runModal()
            return
        }

        alert.beginSheetModal(for: window)
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

private func boolValue(_ value: Any?, defaultValue: Bool = false) -> Bool {
    if let value = value as? Bool {
        return value
    }
    if let value = value as? NSNumber {
        return value.boolValue
    }
    return defaultValue
}

private func intValue(_ value: Any?) -> Int {
    if let value = value as? Int {
        return value
    }
    if let value = value as? NSNumber {
        return value.intValue
    }
    return 0
}

private func webDocumentSaveError(_ message: String) -> NSError {
    NSError(
        domain: "AppifyHostWebDocumentSaveError",
        code: 1,
        userInfo: [
            NSLocalizedDescriptionKey: message,
        ]
    )
}
