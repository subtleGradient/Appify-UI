import AppKit
import AppifyHostCore
import Darwin
import WebKit

final class HostWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, NSWindowDelegate {
    private static let preferredContentSizeMessageName = "appifyPreferredContentSize"
    private static let preferredContentSizeScript = """
    (() => {
      if (window.__APPIFY_HOST_CONTENT_SIZE_OBSERVER__) return;

      const handler = window.webkit?.messageHandlers?.appifyPreferredContentSize;
      if (!handler || typeof handler.postMessage !== "function") return;

      const ignoredTags = new Set(["SCRIPT", "STYLE", "LINK", "META", "TITLE", "TEMPLATE", "NOSCRIPT"]);
      const intrinsicallySizedTags = new Set(["CANVAS", "IMG", "VIDEO", "SVG", "IFRAME", "OBJECT", "EMBED", "INPUT", "SELECT", "TEXTAREA"]);
      const number = (value) => Number.isFinite(value) ? value : 0;
      const cssPixels = (value) => {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const positiveCssPixels = (value) => Math.max(0, cssPixels(value));
      const viewportSize = () => {
        const root = document.documentElement;
        return {
          viewportWidth: number(window.innerWidth || root?.clientWidth || 0),
          viewportHeight: number(window.innerHeight || root?.clientHeight || 0)
        };
      };

      const finiteSize = (value, source, viewport) => {
        if (!value || typeof value !== "object") return null;
        const width = Number(value.width);
        const height = Number(value.height);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
        return {
          width: Math.ceil(width),
          height: Math.ceil(height),
          viewportWidth: viewport.viewportWidth,
          viewportHeight: viewport.viewportHeight,
          source
        };
      };

      const measureExplicitContent = (viewport) => {
        const hooks = [
          window.AppifyHostPreferredContentSize,
          window.AppifyHost?.preferredContentSize
        ];

        for (const hook of hooks) {
          if (!hook) continue;
          try {
            const value = typeof hook === "function" ? hook({
              viewportWidth: viewport.viewportWidth,
              viewportHeight: viewport.viewportHeight
            }) : hook;
            const size = finiteSize(value, "explicit", viewport);
            if (size) return size;
          } catch (error) {
            console.warn("AppifyHost preferred content size hook failed:", error);
          }
        }

        return null;
      };

      const measureElements = (elements, viewport, source, ignoreViewportContainers) => {
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        let count = 0;

        const includeRect = (element, rect, style) => {
          if (!rect || rect.width < 1 || rect.height < 1) return;
          const isViewportWidthContainer = rect.width >= viewport.viewportWidth - 3
            && element.children.length > 0
            && !intrinsicallySizedTags.has(element.tagName);
          if (ignoreViewportContainers && isViewportWidthContainer) return;
          const marginLeft = positiveCssPixels(style.marginLeft);
          const marginTop = positiveCssPixels(style.marginTop);
          const marginRight = positiveCssPixels(style.marginRight);
          const marginBottom = positiveCssPixels(style.marginBottom);
          left = Math.min(left, rect.left + window.scrollX - marginLeft);
          top = Math.min(top, rect.top + window.scrollY - marginTop);
          right = Math.max(right, rect.right + window.scrollX + marginRight);
          bottom = Math.max(bottom, rect.bottom + window.scrollY + marginBottom);
          count += 1;
        };

        const includeElement = (element) => {
          if (!(element instanceof Element) || ignoredTags.has(element.tagName)) return;
          const style = window.getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden" || style.contentVisibility === "hidden") return;
          for (const rect of element.getClientRects()) {
            includeRect(element, rect, style);
          }
        };

        for (const element of elements) {
          includeElement(element);
        }

        if (count <= 0) return null;

        return {
          width: Math.ceil(right - left),
          height: Math.ceil(bottom - top),
          viewportWidth: viewport.viewportWidth,
          viewportHeight: viewport.viewportHeight,
          source
        };
      };

      const measureMarkedContent = (viewport) => {
        return measureElements(
          Array.from(document.querySelectorAll("[data-appify-window-fit], [data-appify-fit-root]")),
          viewport,
          "marked",
          false
        );
      };

      const measureAutomaticContent = (viewport) => {
        const root = document.documentElement;
        const body = document.body;
        const measured = measureElements(
          body ? Array.from(body.querySelectorAll("*")) : [],
          viewport,
          "automatic",
          true
        );
        if (measured) return measured;

        return {
          width: Math.ceil(Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0, viewport.viewportWidth)),
          height: Math.ceil(Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0, viewport.viewportHeight)),
          viewportWidth: viewport.viewportWidth,
          viewportHeight: viewport.viewportHeight,
          source: "automatic"
        };
      };

      const measure = () => {
        const viewport = viewportSize();
        return measureExplicitContent(viewport)
          || measureMarkedContent(viewport)
          || measureAutomaticContent(viewport);
      };

      let timer = 0;
      const post = (reason) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          try {
            handler.postMessage({ ...measure(), reason: String(reason || "measure") });
          } catch (error) {
            console.warn("AppifyHost preferred content size measurement failed:", error);
          }
        }, 60);
      };

      window.__APPIFY_HOST_MEASURE_CONTENT__ = post;
      window.__APPIFY_HOST_CONTENT_SIZE_OBSERVER__ = true;
      try {
        const host = window.AppifyHost && typeof window.AppifyHost === "object" ? window.AppifyHost : {};
        if (!window.AppifyHost || typeof window.AppifyHost !== "object") window.AppifyHost = host;
        if (typeof host.measureContent !== "function") {
          host.measureContent = (reason) => post(String(reason || "app-request"));
        }
      } catch (_) {}

      try {
        const resizeObserver = new ResizeObserver(() => post("resize-observer"));
        if (document.documentElement) resizeObserver.observe(document.documentElement);
        if (document.body) resizeObserver.observe(document.body);
      } catch (_) {}

      try {
        const mutationObserver = new MutationObserver(() => post("mutation-observer"));
        mutationObserver.observe(document.documentElement || document, {
          attributes: true,
          childList: true,
          subtree: true,
          characterData: true
        });
      } catch (_) {}

      window.addEventListener("load", () => post("load"), { once: true });
      window.addEventListener("resize", () => post("window-resize"));
      document.fonts?.ready?.then(() => post("fonts-ready")).catch(() => {});
      for (const image of Array.from(document.images || [])) {
        if (!image.complete) {
          image.addEventListener("load", () => post("image-load"), { once: true });
          image.addEventListener("error", () => post("image-error"), { once: true });
        }
      }
      post("install");
    })();
    """

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
    private var currentWindowFrameAutosaveName: NSWindow.FrameAutosaveName = ""
    private var currentDocumentHasSavedWindowFrame = false
    private var latestPreferredContentMeasurement: PreferredContentMeasurement?
    private var isWaitingForInitialContentFit = false
    private var initialContentFitTimeout: DispatchWorkItem?
    private var didRevealCurrentWebView = false

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
        shouldCascadeWindows = true
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
        loadStatusPage(
            title: "Opening \(documentURL.lastPathComponent)",
            message: "Starting \(configuration.appName)'s app-local server."
        )
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

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

    func windowWillUseStandardFrame(_ window: NSWindow, defaultFrame newFrame: NSRect) -> NSRect {
        guard configuration.windowContentSizing == .automatic else {
            return newFrame
        }

        if let measurement = latestPreferredContentMeasurement,
           let preferredFrame = standardContentFrame(for: measurement, in: window, relativeTo: window.frame),
           isMeaningfulStandardFrame(preferredFrame, from: window.frame)
        {
            return preferredFrame
        }

        return obedientStandardFrame(in: window) ?? newFrame
    }

    private enum CloseValidationResult {
        case clean
        case dirty(String)
    }

    private enum PreferredContentMeasurementSource: String {
        case explicit
        case marked
        case automatic
    }

    private struct PreferredContentMeasurement {
        var contentSize: NSSize
        var viewportSize: NSSize
        var source: PreferredContentMeasurementSource
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
            updateWindowFrameAutosaveName(nil)
            return
        }

        updateWindowFrameAutosaveName(documentURL)

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

    private func updateWindowFrameAutosaveName(_ documentURL: URL?) {
        guard let documentURL else {
            currentWindowFrameAutosaveName = ""
            currentDocumentHasSavedWindowFrame = false
            windowFrameAutosaveName = ""
            return
        }

        let autosaveName = windowFrameAutosaveName(for: documentURL)
        guard currentWindowFrameAutosaveName != autosaveName else {
            return
        }

        currentWindowFrameAutosaveName = autosaveName
        currentDocumentHasSavedWindowFrame = hasSavedWindowFrame(named: autosaveName)
        windowFrameAutosaveName = autosaveName
    }

    private func windowFrameAutosaveName(for documentURL: URL) -> NSWindow.FrameAutosaveName {
        let path = documentURL.standardizedFileURL.path
        let encodedPath = Data(path.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return NSWindow.FrameAutosaveName("AppifyHost.DocumentWindow.\(configuration.bundleIdentifier).\(encodedPath)")
    }

    private func hasSavedWindowFrame(named autosaveName: NSWindow.FrameAutosaveName) -> Bool {
        guard !autosaveName.isEmpty else {
            return false
        }

        return UserDefaults.standard.object(forKey: "NSWindow Frame \(autosaveName)") != nil
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
        if configuration.windowContentSizing == .automatic {
            let userContentController = WKUserContentController()
            userContentController.addUserScript(preferredContentSizeUserScript())
            userContentController.add(
                WeakScriptMessageHandler(delegate: self),
                name: Self.preferredContentSizeMessageName
            )
            webViewConfiguration.userContentController = userContentController
        }

        let webView = WKWebView(frame: window?.contentView?.bounds ?? .zero, configuration: webViewConfiguration)
        webView.isInspectable = true
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = true
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        self.webView = webView
        latestPreferredContentMeasurement = nil
        didRevealCurrentWebView = false
        isWaitingForInitialContentFit = shouldWaitForInitialContentFit
        if isWaitingForInitialContentFit {
            webView.isHidden = true
            scheduleInitialContentFitTimeout(for: webView)
        }
        window?.contentView = webView
        window?.initialFirstResponder = webView
        if !webView.isHidden {
            window?.makeFirstResponder(webView)
        }
        webView.load(URLRequest(url: url))
    }

    private var shouldWaitForInitialContentFit: Bool {
        configuration.windowContentSizing == .automatic && !currentDocumentHasSavedWindowFrame
    }

    private func preferredContentSizeUserScript() -> WKUserScript {
        WKUserScript(
            source: Self.preferredContentSizeScript,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
    }

    private func scheduleInitialContentFitTimeout(for webView: WKWebView) {
        initialContentFitTimeout?.cancel()

        let item = DispatchWorkItem { [weak self, weak webView] in
            guard let self,
                  let webView,
                  self.webView === webView,
                  self.isWaitingForInitialContentFit
            else {
                return
            }

            self.writeLog("WARN: preferred content size was not ready before first reveal.\n")
            self.revealWebView(webView)
        }
        initialContentFitTimeout = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: item)
    }

    private func requestPreferredContentSizeMeasurement(for webView: WKWebView, reason: String) {
        guard configuration.windowContentSizing == .automatic else {
            revealWebView(webView)
            return
        }

        let escapedReason = reason.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        webView.evaluateJavaScript(
            "window.__APPIFY_HOST_MEASURE_CONTENT__ && window.__APPIFY_HOST_MEASURE_CONTENT__('\(escapedReason)');"
        ) { [weak self] _, error in
            if let error {
                self?.writeLog("WARN: preferred content size measurement request failed: \(String(describing: error))\n")
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.preferredContentSizeMessageName,
              let webView,
              configuration.windowContentSizing == .automatic,
              let dictionary = message.body as? [String: Any],
              let contentWidth = positiveCGFloat(dictionary["width"]),
              let contentHeight = positiveCGFloat(dictionary["height"])
        else {
            return
        }

        let viewportWidth = positiveCGFloat(dictionary["viewportWidth"]) ?? 0
        let viewportHeight = positiveCGFloat(dictionary["viewportHeight"]) ?? 0
        let source = PreferredContentMeasurementSource(rawValue: dictionary["source"] as? String ?? "") ?? .automatic
        latestPreferredContentMeasurement = PreferredContentMeasurement(
            contentSize: NSSize(width: contentWidth, height: contentHeight),
            viewportSize: NSSize(width: viewportWidth, height: viewportHeight),
            source: source
        )

        if isWaitingForInitialContentFit {
            applyInitialContentFitIfAppropriate(to: webView)
            revealWebView(webView)
        }
    }

    private func applyInitialContentFitIfAppropriate(to webView: WKWebView) {
        guard let window,
              self.webView === webView,
              let measurement = latestPreferredContentMeasurement,
              let targetFrame = preferredContentFrame(for: measurement, in: window, relativeTo: window.frame)
        else {
            return
        }

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0
            window.setFrame(targetFrame, display: true, animate: false)
        }
    }

    private func revealWebView(_ webView: WKWebView) {
        guard self.webView === webView,
              !didRevealCurrentWebView
        else {
            return
        }

        initialContentFitTimeout?.cancel()
        initialContentFitTimeout = nil
        isWaitingForInitialContentFit = false
        didRevealCurrentWebView = true
        webView.isHidden = false
        window?.makeFirstResponder(webView)
    }

    private func preferredContentFrame(
        for measurement: PreferredContentMeasurement,
        in window: NSWindow,
        relativeTo referenceFrame: NSRect
    ) -> NSRect? {
        guard let frameSize = measuredFrameSize(for: measurement, in: window) else {
            return nil
        }

        let screen = window.screen ?? NSScreen.main
        guard let visibleFrame = screen?.visibleFrame else {
            return nil
        }

        let maximumFitFrame = NSSize(
            width: floor(visibleFrame.width * 0.92),
            height: floor(visibleFrame.height * 0.92)
        )
        guard frameSize.width < maximumFitFrame.width,
              frameSize.height < maximumFitFrame.height
        else {
            return nil
        }

        if measurement.source == .automatic,
           isViewportLike(measurement: measurement, targetFrameSize: frameSize, visibleFrame: visibleFrame) {
            return nil
        }

        return frame(size: frameSize, relativeTo: referenceFrame, visibleFrame: visibleFrame)
    }

    private func standardContentFrame(
        for measurement: PreferredContentMeasurement,
        in window: NSWindow,
        relativeTo referenceFrame: NSRect
    ) -> NSRect? {
        guard let measuredFrameSize = measuredFrameSize(for: measurement, in: window) else {
            return nil
        }

        let screen = window.screen ?? NSScreen.main
        guard let visibleFrame = screen?.visibleFrame else {
            return nil
        }

        if measurement.source == .automatic,
           isViewportLike(measurement: measurement, targetFrameSize: measuredFrameSize, visibleFrame: visibleFrame) {
            return nil
        }

        let minFrameSize = window.minSize
        let maximumUsefulWidth = floor(visibleFrame.width * 0.92)
        let width: CGFloat
        switch measurement.source {
        case .explicit, .marked:
            width = min(max(measuredFrameSize.width, minFrameSize.width), maximumUsefulWidth)

        case .automatic:
            if referenceFrame.width >= visibleFrame.width * 0.94 {
                width = min(max(referenceFrame.width, minFrameSize.width), visibleFrame.width)
            } else if measuredFrameSize.width < referenceFrame.width - 64 {
                width = max(measuredFrameSize.width, minFrameSize.width)
            } else {
                width = min(max(referenceFrame.width, minFrameSize.width), visibleFrame.width)
            }
        }

        let height = min(max(measuredFrameSize.height, minFrameSize.height), visibleFrame.height)
        let frameSize = NSSize(width: width, height: height)
        return frame(size: frameSize, relativeTo: referenceFrame, visibleFrame: visibleFrame)
    }

    private func isMeaningfulStandardFrame(_ frame: NSRect, from currentFrame: NSRect) -> Bool {
        let widthDelta = abs(frame.width - currentFrame.width)
        let heightDelta = abs(frame.height - currentFrame.height)
        let currentArea = max(currentFrame.width * currentFrame.height, 1)
        let frameArea = max(frame.width * frame.height, 1)
        let areaDeltaRatio = abs(frameArea - currentArea) / currentArea
        return widthDelta >= 48 || heightDelta >= 48 || areaDeltaRatio >= 0.10
    }

    private func measuredFrameSize(for measurement: PreferredContentMeasurement, in window: NSWindow) -> NSSize? {
        let contentSize = NSSize(
            width: ceil(measurement.contentSize.width) + 2,
            height: ceil(measurement.contentSize.height) + 2
        )
        guard contentSize.width.isFinite,
              contentSize.height.isFinite,
              contentSize.width > 0,
              contentSize.height > 0
        else {
            return nil
        }

        let targetFrameSize = window.frameRect(
            forContentRect: NSRect(origin: .zero, size: contentSize)
        ).size
        let minFrameSize = window.minSize
        return NSSize(
            width: max(targetFrameSize.width, minFrameSize.width),
            height: max(targetFrameSize.height, minFrameSize.height)
        )
    }

    private func obedientStandardFrame(in window: NSWindow) -> NSRect? {
        let screen = window.screen ?? NSScreen.main
        guard let visibleFrame = screen?.visibleFrame else {
            return nil
        }

        let currentFrame = window.frame
        let minFrameSize = window.minSize
        let frameSize = NSSize(
            width: obedientLength(current: currentFrame.width, available: visibleFrame.width, minimum: minFrameSize.width),
            height: obedientLength(current: currentFrame.height, available: visibleFrame.height, minimum: minFrameSize.height)
        )
        return frame(size: frameSize, relativeTo: currentFrame, visibleFrame: visibleFrame)
    }

    private func obedientLength(current: CGFloat, available: CGFloat, minimum: CGFloat) -> CGFloat {
        if current >= available * 0.86 {
            return max(floor(available * 0.72), minimum)
        }
        if current <= available * 0.64 {
            return max(floor(available * 0.86), minimum)
        }
        return min(max(current, minimum), available)
    }

    private func frame(size frameSize: NSSize, relativeTo referenceFrame: NSRect, visibleFrame: NSRect) -> NSRect {
        let frame = NSRect(
            x: referenceFrame.minX,
            y: referenceFrame.maxY - frameSize.height,
            width: frameSize.width,
            height: frameSize.height
        )
        return constrainedFrame(frame, to: visibleFrame)
    }

    private func isViewportLike(
        measurement: PreferredContentMeasurement,
        targetFrameSize: NSSize,
        visibleFrame: NSRect
    ) -> Bool {
        let widthDelta = abs(measurement.contentSize.width - measurement.viewportSize.width)
        let heightDelta = abs(measurement.contentSize.height - measurement.viewportSize.height)
        let nearlyViewportSized = widthDelta <= 3 && heightDelta <= 3
        let consumesMostScreen = targetFrameSize.width > visibleFrame.width * 0.85
            || targetFrameSize.height > visibleFrame.height * 0.85
        return nearlyViewportSized && consumesMostScreen
    }

    private func constrainedFrame(_ frame: NSRect, to visibleFrame: NSRect) -> NSRect {
        var constrained = frame
        if constrained.maxX > visibleFrame.maxX {
            constrained.origin.x = visibleFrame.maxX - constrained.width
        }
        if constrained.minX < visibleFrame.minX {
            constrained.origin.x = visibleFrame.minX
        }
        if constrained.maxY > visibleFrame.maxY {
            constrained.origin.y = visibleFrame.maxY - constrained.height
        }
        if constrained.minY < visibleFrame.minY {
            constrained.origin.y = visibleFrame.minY
        }
        return constrained
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
        if !webView.isHidden {
            window?.makeFirstResponder(webView)
        }
        requestPreferredContentSizeMeasurement(for: webView, reason: "didFinish")
        if configuration.windowContentSizing == .disabled {
            revealWebView(webView)
        }
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

private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?

    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
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

private func positiveCGFloat(_ value: Any?) -> CGFloat? {
    let number: Double?
    if let value = value as? Double {
        number = value
    } else if let value = value as? Int {
        number = Double(value)
    } else if let value = value as? NSNumber {
        number = value.doubleValue
    } else {
        number = nil
    }

    guard let number,
          number.isFinite,
          number > 0
    else {
        return nil
    }

    return CGFloat(number)
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
