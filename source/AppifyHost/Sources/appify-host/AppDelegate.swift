import AppKit
import AppifyHostCore
import UniformTypeIdentifiers
import WebKit

protocol AppifyHostWebViewReloading: AnyObject {
    var canReloadWebView: Bool { get }

    func reloadWebView()
}

protocol AppifyHostWebViewNavigating: AnyObject {
    var canGoBackInWebView: Bool { get }
    var canGoForwardInWebView: Bool { get }

    func goBackInWebView()
    func goForwardInWebView()
}

protocol AppifyHostWebViewInspecting: AnyObject {
    var canOpenWebInspector: Bool { get }

    func openWebInspectorFromMenu()
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSOpenSavePanelDelegate, NSMenuItemValidation, NSMenuDelegate {
    private var didReceiveDocumentOpenEvent = false
    private var configuration: AppifyHostConfiguration?
    private var infoWindowController: AppifyHostInfoWindowController?
    private var terminateAfterHostWindowsClose = false
    private weak var openRecentMenu: NSMenu?

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            configuration = try AppifyHostRuntime.loadConfiguration()
        } catch {
            showFatalConfigurationError(error)
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.configureMainMenu()
            self?.showConfiguredHelpIfNeeded()
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self,
                  !self.didReceiveDocumentOpenEvent,
                  NSDocumentController.shared.documents.isEmpty
            else {
                return
            }
            self.showStartupChoice()
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                return
            }
            self.didReceiveDocumentOpenEvent = true
            for url in urls {
                self.openURL(url)
            }
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if terminateAfterHostWindowsClose {
            terminateAfterHostWindowsClose = false
            return .terminateNow
        }

        let hostWindows = visibleHostWindows(in: sender)
        guard !hostWindows.isEmpty else {
            return .terminateNow
        }

        terminateAfterHostWindowsClose = true
        hostWindows.forEach { $0.performClose(nil) }
        finishTerminationAfterHostWindowsClose(deadline: Date().addingTimeInterval(30.0))
        return .terminateCancel
    }

    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool {
        guard let configuration else {
            return false
        }

        return configuration.documentMode != .folderMarker
    }

    func applicationOpenUntitledFile(_ sender: NSApplication) -> Bool {
        guard let configuration,
              configuration.documentMode != .folderMarker
        else {
            return false
        }

        showNewDocument()
        return true
    }

    func applicationShouldSaveApplicationState(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldRestoreApplicationState(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        for document in NSDocumentController.shared.documents {
            (document as? AppifyHostDocument)?.stopServerForAppTermination()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            showStartupChoice()
        }

        return true
    }

    @objc private func newDocumentFromMenu(_ sender: Any?) {
        DispatchQueue.main.async { [weak self] in
            self?.showNewDocument()
        }
    }

    @objc private func openDocumentFromMenu(_ sender: Any?) {
        DispatchQueue.main.async { [weak self] in
            self?.showOpenPanel()
        }
    }

    @objc private func openRecentDocumentFromMenu(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else {
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else {
                return
            }

            self.didReceiveDocumentOpenEvent = true
            self.openDocument(at: url)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    @MainActor
    @objc private func reloadWebViewFromMenu(_ sender: Any?) {
        currentWebViewReloadingController()?.reloadWebView()
    }

    @MainActor
    @objc private func goBackInWebViewFromMenu(_ sender: Any?) {
        currentWebViewNavigatingController()?.goBackInWebView()
    }

    @MainActor
    @objc private func goForwardInWebViewFromMenu(_ sender: Any?) {
        currentWebViewNavigatingController()?.goForwardInWebView()
    }

    @MainActor
    @objc private func openWebInspectorFromMenu(_ sender: Any?) {
        currentWebViewInspectingController()?.openWebInspectorFromMenu()
    }

    @MainActor
    @objc private func showAboutFromMenu(_ sender: Any?) {
        guard let configuration else {
            NSApplication.shared.orderFrontStandardAboutPanel(sender)
            return
        }

        showInfoWindow(
            title: "About \(configuration.appName)",
            html: aboutHTML(configuration: configuration)
        )
    }

    @objc private func showAppHelpFromMenu(_ sender: Any?) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let configuration = self.configuration else {
                return
            }
            self.showInfoWindow(
                title: "\(configuration.appName) Help",
                html: helpHTML(configuration: configuration)
            )
        }
    }

    private func visibleHostWindows(in application: NSApplication) -> [NSWindow] {
        application.windows.filter { window in
            window.isVisible && window.windowController is HostWindowController
        }
    }

    private func finishTerminationAfterHostWindowsClose(deadline: Date) {
        if visibleHostWindows(in: NSApplication.shared).isEmpty {
            NSApplication.shared.terminate(nil)
            return
        }

        if Date() < deadline {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                self?.finishTerminationAfterHostWindowsClose(deadline: deadline)
            }
            return
        }

        terminateAfterHostWindowsClose = false
    }

    @MainActor
    private func showStartupChoice() {
        guard let configuration else {
            return
        }

        switch configuration.documentMode {
        case .contentPackage, .contentPackageOrFile:
            showNewDocument()

        case .folderMarker:
            showFolderPicker()

        case .fileDocument:
            showNewDocument()
        }
    }

    @MainActor
    private func showNewDocument() {
        guard let configuration else {
            return
        }

        switch configuration.documentMode {
        case .contentPackage, .contentPackageOrFile, .fileDocument:
            createUntitledDocument(configuration: configuration)
        case .folderMarker:
            showFolderPicker()
        }
    }

    @MainActor
    private func createUntitledDocument(configuration: AppifyHostConfiguration) {
        do {
            let documentURL = PackageDocument.untitledDocumentURL(configuration: configuration)
            try PackageDocument.createUntitledDocument(at: documentURL, configuration: configuration)
            let document = AppifyHostDocument()
            document.configureUntitledDocument(at: documentURL)
            NSDocumentController.shared.addDocument(document)
            document.makeWindowControllers()
            document.showWindows()
            didReceiveDocumentOpenEvent = true
        } catch {
            showAlert(title: "Could Not Create \(configuration.appName)", message: String(describing: error))
        }
    }

    @MainActor
    private func showFolderPicker() {
        guard let configuration else {
            return
        }

        let panel = NSOpenPanel()
        panel.title = "New \(configuration.windowTitlePrefix) Window"
        panel.message = "Choose a folder. \(configuration.appName) will run in that folder."
        panel.prompt = "Open"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false

        guard panel.runModal() == .OK, let folderURL = panel.url else {
            return
        }

        do {
            let packageURL = PackageDocument.packageURL(forFolder: folderURL, configuration: configuration)
            if !FileManager.default.fileExists(atPath: packageURL.path) {
                try FileManager.default.createDirectory(at: packageURL, withIntermediateDirectories: false)
            }
            didReceiveDocumentOpenEvent = true
            openDocument(at: packageURL)
        } catch {
            showAlert(title: "Could Not Create \(configuration.appName) Package", message: String(describing: error))
        }
    }

    @MainActor
    private func showOpenPanel(initialRoute: String? = nil) {
        guard let configuration else {
            return
        }

        let panel = NSOpenPanel()
        panel.title = "Open \(configuration.appName)"
        panel.message = openPanelMessage(configuration: configuration)
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.treatsFilePackagesAsDirectories = false
        if usesExtensionFilteredOpenPanel(configuration: configuration) {
            panel.delegate = self
        } else {
            let allowedTypes = allowedContentTypes(configuration: configuration)
            if !allowedTypes.isEmpty {
                panel.allowedContentTypes = allowedTypes
            }
        }

        guard panel.runModal() == .OK else {
            return
        }

        didReceiveDocumentOpenEvent = true
        for url in panel.urls {
            openDocument(at: url, initialRoute: initialRoute)
        }
    }

    func panel(_ sender: Any, shouldEnable url: URL) -> Bool {
        guard let configuration,
              usesExtensionFilteredOpenPanel(configuration: configuration)
        else {
            return true
        }

        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
           isDirectory.boolValue
        {
            return true
        }

        let extensionName = url.pathExtension.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return configuration.documentExtensions.contains(extensionName)
    }

    @MainActor
    private func openURL(_ url: URL) {
        guard let configuration else {
            showAlert(title: "Could Not Open URL", message: "The app configuration is not loaded.")
            return
        }

        guard AppifyHostDeepLink.hasAllowedScheme(url, schemes: configuration.deepLinkSchemes) else {
            openDocument(at: url)
            return
        }

        do {
            let deepLink = try AppifyHostDeepLink.parse(url, allowedSchemes: configuration.deepLinkSchemes)
            switch deepLink.command {
            case .open:
                guard let documentURL = deepLink.documentURL else {
                    throw AppifyHostError.invalidOpenURL("Deep link did not include a document path.")
                }
                guard confirmDeepLinkOpen(documentURL: documentURL, route: deepLink.route) else {
                    return
                }
                openDocument(at: documentURL, initialRoute: deepLink.route)

            case .choose:
                showOpenPanel(initialRoute: deepLink.route)
            }
        } catch {
            showAlert(title: "Could Not Open Deep Link", message: String(describing: error))
        }
    }

    @MainActor
    private func openDocument(at url: URL, initialRoute: String? = nil) {
        guard let configuration else {
            showAlert(title: "Could Not Open Document", message: "The app configuration is not loaded.")
            return
        }

        do {
            let documentURL = try PackageDocument.documentURL(forPackage: url, configuration: configuration)
            if let existingDocument = existingOpenDocument(at: documentURL) {
                noteRecentDocument(at: documentURL)
                if let initialRoute {
                    existingDocument.openDeepLinkRoute(initialRoute)
                }
                existingDocument.showWindows()
                existingDocument.windowControllers.forEach { $0.window?.makeKeyAndOrderFront(nil) }
                return
            }

            let document = AppifyHostDocument()
            try document.read(from: documentURL, ofType: configuration.documentKindEnvironmentValue)
            document.fileType = configuration.documentKindEnvironmentValue
            document.fileURL = documentURL
            if let modificationDate = try? documentURL.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate {
                document.fileModificationDate = modificationDate
            }

            NSDocumentController.shared.addDocument(document)
            document.makeWindowControllers()
            if let initialRoute {
                document.openDeepLinkRoute(initialRoute)
            }
            document.showWindows()
            noteRecentDocument(at: documentURL)
        } catch {
            showAlert(title: "Could Not Open Document", message: String(describing: error))
        }
    }

    @MainActor
    private func existingOpenDocument(at documentURL: URL) -> AppifyHostDocument? {
        let standardizedURL = documentURL.standardizedFileURL
        return NSDocumentController.shared.documents.compactMap { $0 as? AppifyHostDocument }.first { document in
            document.activeDocumentURL == standardizedURL
        }
    }

    @MainActor
    private func confirmDeepLinkOpen(documentURL: URL, route: String?) -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "Open \(configuration?.appName ?? "Document") Deep Link?"
        let routeLine = route.map { "\nRoute: \($0)" } ?? ""
        alert.informativeText = """
        A deep link wants to open this local document:
        \(documentURL.path)\(routeLine)
        """
        alert.addButton(withTitle: "Open")
        alert.addButton(withTitle: "Cancel")
        return alert.runModal() == .alertFirstButtonReturn
    }

    @MainActor
    private func configureMainMenu() {
        guard let configuration else {
            return
        }

        let mainMenu = NSMenu()
        NSApp.mainMenu = mainMenu

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(
            withTitle: "About \(configuration.appName)",
            action: #selector(showAboutFromMenu(_:)),
            keyEquivalent: ""
        ).target = self
        appMenu.addItem(.separator())
        let servicesMenu = NSMenu()
        NSApp.servicesMenu = servicesMenu
        let servicesItem = appMenu.addItem(withTitle: "Services", action: nil, keyEquivalent: "")
        servicesItem.submenu = servicesMenu
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide \(configuration.appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthersItem = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthersItem.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit \(configuration.appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "File")
        fileMenuItem.submenu = fileMenu
        let newItem = fileMenu.addItem(withTitle: "New", action: #selector(newDocumentFromMenu(_:)), keyEquivalent: "n")
        newItem.target = self
        let openItem = fileMenu.addItem(withTitle: "Open...", action: #selector(openDocumentFromMenu(_:)), keyEquivalent: "o")
        openItem.target = self
        let openRecentItem = fileMenu.addItem(withTitle: "Open Recent", action: nil, keyEquivalent: "")
        let openRecentMenu = NSMenu(title: "Open Recent")
        openRecentMenu.delegate = self
        self.openRecentMenu = openRecentMenu
        rebuildOpenRecentMenu(openRecentMenu)
        openRecentItem.submenu = openRecentMenu
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileMenu.addItem(withTitle: "Save", action: #selector(NSDocument.save(_:)), keyEquivalent: "s")
        let saveAsItem = fileMenu.addItem(withTitle: "Save As...", action: #selector(NSDocument.saveAs(_:)), keyEquivalent: "S")
        saveAsItem.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(withTitle: "Revert to Saved", action: Selector(("revertToSaved:")), keyEquivalent: "")

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenuItem.submenu = editMenu
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redoItem = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Delete", action: #selector(NSText.delete(_:)), keyEquivalent: "\u{8}")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        viewMenuItem.submenu = viewMenu
        let backItem = viewMenu.addItem(withTitle: "Back", action: #selector(goBackInWebViewFromMenu(_:)), keyEquivalent: "[")
        backItem.target = self
        let forwardItem = viewMenu.addItem(withTitle: "Forward", action: #selector(goForwardInWebViewFromMenu(_:)), keyEquivalent: "]")
        forwardItem.target = self
        viewMenu.addItem(.separator())
        let reloadItem = viewMenu.addItem(withTitle: "Reload", action: #selector(reloadWebViewFromMenu(_:)), keyEquivalent: "r")
        reloadItem.target = self
        viewMenu.addItem(.separator())
        let developerItem = viewMenu.addItem(withTitle: "Developer", action: nil, keyEquivalent: "")
        let developerMenu = NSMenu(title: "Developer")
        developerItem.submenu = developerMenu
        let inspectorItem = developerMenu.addItem(
            withTitle: "Open Web Inspector",
            action: #selector(openWebInspectorFromMenu(_:)),
            keyEquivalent: "i"
        )
        inspectorItem.keyEquivalentModifierMask = [.command, .option]
        inspectorItem.target = self
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
            .keyEquivalentModifierMask = [.command, .control]

        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenuItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")

        let helpMenuItem = NSMenuItem()
        mainMenu.addItem(helpMenuItem)
        let helpMenu = NSMenu(title: "Help")
        helpMenuItem.submenu = helpMenu
        NSApp.helpMenu = helpMenu
        let helpItem = helpMenu.addItem(
            withTitle: "\(configuration.appName) Help",
            action: #selector(showAppHelpFromMenu(_:)),
            keyEquivalent: "?"
        )
        helpItem.target = self
    }

    @MainActor
    func menuNeedsUpdate(_ menu: NSMenu) {
        guard let openRecentMenu, menu === openRecentMenu else {
            return
        }

        rebuildOpenRecentMenu(menu)
    }

    @MainActor
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(goBackInWebViewFromMenu(_:)) {
            return currentWebViewNavigatingController()?.canGoBackInWebView == true
        }

        if menuItem.action == #selector(goForwardInWebViewFromMenu(_:)) {
            return currentWebViewNavigatingController()?.canGoForwardInWebView == true
        }

        if menuItem.action == #selector(reloadWebViewFromMenu(_:)) {
            return currentWebViewReloadingController()?.canReloadWebView == true
        }

        if menuItem.action == #selector(openWebInspectorFromMenu(_:)) {
            return currentWebViewInspectingController()?.canOpenWebInspector == true
        }

        return true
    }

    @MainActor
    private func currentWebViewReloadingController() -> AppifyHostWebViewReloading? {
        if let controller = NSApp.keyWindow?.windowController as? AppifyHostWebViewReloading {
            return controller
        }

        return NSApp.mainWindow?.windowController as? AppifyHostWebViewReloading
    }

    @MainActor
    private func currentWebViewNavigatingController() -> AppifyHostWebViewNavigating? {
        if let controller = NSApp.keyWindow?.windowController as? AppifyHostWebViewNavigating {
            return controller
        }

        return NSApp.mainWindow?.windowController as? AppifyHostWebViewNavigating
    }

    @MainActor
    private func currentWebViewInspectingController() -> AppifyHostWebViewInspecting? {
        if let controller = NSApp.keyWindow?.windowController as? AppifyHostWebViewInspecting {
            return controller
        }

        return NSApp.mainWindow?.windowController as? AppifyHostWebViewInspecting
    }

    @MainActor
    private func noteRecentDocument(at url: URL) {
        NSDocumentController.shared.noteNewRecentDocumentURL(url.standardizedFileURL)

        if let openRecentMenu {
            rebuildOpenRecentMenu(openRecentMenu)
        }
    }

    @MainActor
    private func rebuildOpenRecentMenu(_ menu: NSMenu) {
        let recentURLs = NSDocumentController.shared.recentDocumentURLs

        menu.removeAllItems()

        for url in recentURLs {
            let item = menu.addItem(
                withTitle: recentMenuTitle(for: url),
                action: #selector(openRecentDocumentFromMenu(_:)),
                keyEquivalent: ""
            )
            item.target = self
            item.representedObject = url
            item.toolTip = url.path
        }

        if !recentURLs.isEmpty {
            menu.addItem(.separator())
        }

        let clearRecentItem = menu.addItem(
            withTitle: "Clear Menu",
            action: #selector(NSDocumentController.clearRecentDocuments(_:)),
            keyEquivalent: ""
        )
        clearRecentItem.target = NSDocumentController.shared
        clearRecentItem.isEnabled = !recentURLs.isEmpty
    }

    private func recentMenuTitle(for url: URL) -> String {
        let title = url.lastPathComponent
        if !title.isEmpty {
            return title
        }

        return url.path
    }

    @MainActor
    private func showConfiguredHelpIfNeeded() {
        guard let configuration,
              let help = configuration.firstLaunchHelp
        else {
            return
        }

        let key = firstLaunchHelpDefaultsKey(configuration: configuration, help: help)
        guard !UserDefaults.standard.bool(forKey: key) else {
            return
        }

        UserDefaults.standard.set(true, forKey: key)
        showURLWindow(title: help.windowTitle, url: help.url)
    }

    private func firstLaunchHelpDefaultsKey(
        configuration: AppifyHostConfiguration,
        help: AppifyHostFirstLaunchHelp
    ) -> String {
        "AppifyHost.FirstLaunchHelp.\(configuration.bundleIdentifier).\(help.url.absoluteString)"
    }

    @MainActor
    private func showInfoWindow(title: String, html: String) {
        let controller = infoWindowController ?? AppifyHostInfoWindowController()
        infoWindowController = controller
        controller.show(title: title, html: html, baseURL: configuration?.bundleURL)
    }

    @MainActor
    private func showURLWindow(title: String, url: URL) {
        let controller = infoWindowController ?? AppifyHostInfoWindowController()
        infoWindowController = controller
        controller.show(title: title, url: url)
    }

    private struct AppSourceInfo {
        var repositoryURL: String?
        var commit: String?
        var appPath: String?
        var sourceDirectory: String
        var sourceDirectoryURL: URL
        var readmeURL: URL?

        var githubAppURL: URL? {
            AppDelegate.sourceWebURL(repositoryURL: repositoryURL, commit: commit, path: appPath)
        }

        var githubSourceURL: URL? {
            guard let appPath else {
                return nil
            }

            return AppDelegate.sourceWebURL(
                repositoryURL: repositoryURL,
                commit: commit,
                path: appPath + "/" + sourceDirectory
            )
        }
    }

    private struct InferredGitReference {
        var repositoryURL: String?
        var commit: String?
        var appPath: String?
    }

    private func aboutHTML(configuration: AppifyHostConfiguration) -> String {
        let source = appSourceInfo(configuration: configuration)
        let notice = configuration.aboutNotice
        let message = notice?.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? notice?.message
            : "\(configuration.appName) is a self-contained Appify UI bundle."
        let links = notice?.links ?? []

        return htmlDocument(
            title: "About \(configuration.appName)",
            body: """
            <header>
              <p class="eyebrow">About this app</p>
              <h1>\(htmlEscaped(configuration.appName))</h1>
            </header>
            <section>
              \(paragraphsHTML(message ?? ""))
            </section>
            <section>
              <h2>App Identity</h2>
              <dl>
                <dt>Bundle identifier</dt>
                <dd><code>\(htmlEscaped(configuration.bundleIdentifier))</code></dd>
                <dt>Document extensions</dt>
                <dd>\(htmlEscaped(configuration.documentExtensions.map { ".\($0)" }.joined(separator: ", ")))</dd>
                <dt>App-local source</dt>
                <dd><a href="\(htmlAttributeEscaped(source.sourceDirectoryURL.absoluteString))"><code>\(htmlEscaped(source.sourceDirectory))</code></a></dd>
              </dl>
            </section>
            \(sourceLinksHTML(source: source))
            \(aboutLinksHTML(links))
            <section>
              <h2>Hackability</h2>
              <p>This app carries its app-specific source inside the bundle. Open the source folder, read its README, edit the runner or app server, then clone the app bundle when you want a nearby tool with different behavior.</p>
            </section>
            """
        )
    }

    private func helpHTML(configuration: AppifyHostConfiguration) -> String {
        let source = appSourceInfo(configuration: configuration)
        let extensionList = configuration.documentExtensions.map { ".\($0)" }.joined(separator: ", ")
        let configuredHelpLink: String
        if let help = configuration.firstLaunchHelp {
            configuredHelpLink = """
            <li><a href="\(htmlAttributeEscaped(help.url.absoluteString))">\(htmlEscaped(help.windowTitle))</a></li>
            """
        } else {
            configuredHelpLink = ""
        }

        return htmlDocument(
            title: "\(configuration.appName) Help",
            body: """
            <header>
              <p class="eyebrow">Help</p>
              <h1>\(htmlEscaped(configuration.appName))</h1>
            </header>
            <section>
              <p>\(htmlEscaped(configuration.appName)) opens \(htmlEscaped(extensionList)) documents with an app-local server and a native WebKit window.</p>
            </section>
            <section>
              <h2>Common Actions</h2>
              <ul>
                <li>Use File > Open... to open an existing document or package.</li>
                <li>Use File > New when this app supports creating an untitled document.</li>
                <li>Use View > Reload to restart the current web view after editing local app code.</li>
                <li>Use View > Developer > Open Web Inspector to inspect the running web UI.</li>
                \(configuredHelpLink)
              </ul>
            </section>
            \(sourceLinksHTML(source: source))
            <section>
              <h2>Customize or Clone</h2>
              <p>Start in the app-local source folder. Its README explains the bundle shape, where to edit behavior, and how to copy a nearby app into a new specialized tool.</p>
            </section>
            """
        )
    }

    private func appSourceInfo(configuration: AppifyHostConfiguration) -> AppSourceInfo {
        let configured = configuration.sourceReference
        let inferred = inferGitReference(bundleURL: configuration.bundleURL)
        let sourceDirectory = configured?.sourceDirectory
            ?? defaultSourceDirectory(in: configuration.bundleURL)
        let sourceDirectoryURL = configuration.bundleURL
            .appendingPathComponent(sourceDirectory, isDirectory: true)
            .standardizedFileURL
        let readmeURL = sourceDirectoryURL.appendingPathComponent("README.md", isDirectory: false)

        return AppSourceInfo(
            repositoryURL: configured?.repositoryURL ?? inferred?.repositoryURL,
            commit: configured?.commit ?? inferred?.commit,
            appPath: configured?.appPath ?? inferred?.appPath,
            sourceDirectory: sourceDirectory,
            sourceDirectoryURL: sourceDirectoryURL,
            readmeURL: FileManager.default.fileExists(atPath: readmeURL.path) ? readmeURL : nil
        )
    }

    private func defaultSourceDirectory(in bundleURL: URL) -> String {
        let runnerPath = bundleURL
            .appendingPathComponent("Contents/Resources/Runner", isDirectory: true)
            .path
        if FileManager.default.fileExists(atPath: runnerPath) {
            return "Contents/Resources/Runner"
        }

        return "Contents/Resources/AppServer"
    }

    private func inferGitReference(bundleURL: URL) -> InferredGitReference? {
        guard let rootPath = gitOutput(["rev-parse", "--show-toplevel"], in: bundleURL) else {
            return nil
        }

        let rootURL = URL(fileURLWithPath: rootPath, isDirectory: true).standardizedFileURL
        return InferredGitReference(
            repositoryURL: gitOutput(["config", "--get", "remote.origin.url"], in: rootURL),
            commit: gitOutput(["rev-parse", "HEAD"], in: rootURL),
            appPath: relativePath(from: rootURL, to: bundleURL)
        )
    }

    private func gitOutput(_ arguments: [String], in directory: URL) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["-C", directory.path] + arguments
        let stdout = Pipe()
        process.standardOutput = stdout
        process.standardError = Pipe()

        do {
            try process.run()
        } catch {
            return nil
        }

        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            return nil
        }

        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return output?.isEmpty == false ? output : nil
    }

    private func relativePath(from rootURL: URL, to url: URL) -> String? {
        let rootPath = rootURL.standardizedFileURL.path
        let path = url.standardizedFileURL.path
        if path == rootPath {
            return "."
        }
        guard path.hasPrefix(rootPath + "/") else {
            return nil
        }

        return String(path.dropFirst(rootPath.count + 1))
    }

    private func htmlDocument(title: String, body: String) -> String {
        """
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>\(htmlEscaped(title))</title>
          <style>
            :root { color-scheme: light dark; }
            body {
              margin: 0;
              padding: 32px;
              max-width: 860px;
              color: CanvasText;
              background: Canvas;
              font: -apple-system-body;
              line-height: 1.45;
            }
            header { margin-bottom: 28px; }
            .eyebrow {
              margin: 0 0 6px;
              color: color-mix(in srgb, CanvasText 62%, transparent);
              font: -apple-system-caption1;
              text-transform: uppercase;
            }
            h1 { margin: 0; font: -apple-system-title1; }
            h2 { margin: 28px 0 8px; font: -apple-system-title3; }
            p { margin: 0 0 10px; }
            ul { margin: 8px 0 0; padding-left: 22px; }
            li { margin: 6px 0; }
            dl {
              display: grid;
              grid-template-columns: max-content 1fr;
              gap: 8px 18px;
              margin: 10px 0 0;
            }
            dt { color: color-mix(in srgb, CanvasText 68%, transparent); }
            dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
            code {
              font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
              overflow-wrap: anywhere;
            }
            a { color: LinkText; }
          </style>
        </head>
        <body>
        \(body)
        </body>
        </html>
        """
    }

    private func sourceLinksHTML(source: AppSourceInfo) -> String {
        var items: [String] = []
        if let githubAppURL = source.githubAppURL {
            items.append(linkListItem(title: "GitHub app bundle at this commit", url: githubAppURL))
        }
        if let githubSourceURL = source.githubSourceURL {
            items.append(linkListItem(title: "GitHub app source folder at this commit", url: githubSourceURL))
        }
        items.append(linkListItem(title: "Local app source folder", url: source.sourceDirectoryURL))
        if let readmeURL = source.readmeURL {
            items.append(linkListItem(title: "Local hacking README", url: readmeURL))
        }

        return """
        <section>
          <h2>Source</h2>
          <ul>
            \(items.joined(separator: "\n"))
          </ul>
        </section>
        """
    }

    private func aboutLinksHTML(_ links: [AppifyHostAboutLink]) -> String {
        guard !links.isEmpty else {
            return ""
        }

        let items = links.compactMap { link -> String? in
            guard let url = URL(string: link.url) else {
                return nil
            }
            return linkListItem(title: link.title, url: url)
        }.joined(separator: "\n")

        guard !items.isEmpty else {
            return ""
        }

        return """
        <section>
          <h2>Credits and Links</h2>
          <ul>
            \(items)
          </ul>
        </section>
        """
    }

    private func linkListItem(title: String, url: URL) -> String {
        """
        <li><a href="\(htmlAttributeEscaped(url.absoluteString))">\(htmlEscaped(title))</a></li>
        """
    }

    private func paragraphsHTML(_ text: String) -> String {
        text.components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .map { "<p>\(htmlEscaped($0).replacingOccurrences(of: "\n", with: "<br>"))</p>" }
            .joined(separator: "\n")
    }

    private func htmlEscaped(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    private func htmlAttributeEscaped(_ value: String) -> String {
        htmlEscaped(value)
    }

    private static func sourceWebURL(repositoryURL: String?, commit: String?, path: String?) -> URL? {
        guard let repositoryURL,
              let commit,
              let path,
              let normalizedRepositoryURL = normalizedGitHubRepositoryURL(repositoryURL)
        else {
            return nil
        }

        return URL(string: "\(normalizedRepositoryURL)/tree/\(urlPathComponent(commit))/\(urlPath(path))")
    }

    private static func normalizedGitHubRepositoryURL(_ repositoryURL: String) -> String? {
        var value = repositoryURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasSuffix(".git") {
            value.removeLast(4)
        }

        if value.hasPrefix("git@github.com:") {
            let path = String(value.dropFirst("git@github.com:".count))
            return "https://github.com/\(path)"
        }

        if value.hasPrefix("http://github.com/") {
            return "https://" + String(value.dropFirst("http://".count))
        }

        if value.hasPrefix("https://github.com/") {
            return value
        }

        return nil
    }

    private static func urlPath(_ path: String) -> String {
        path.split(separator: "/", omittingEmptySubsequences: false)
            .map { urlPathComponent(String($0)) }
            .joined(separator: "/")
    }

    private static func urlPathComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }

    private func openPanelMessage(configuration: AppifyHostConfiguration) -> String {
        let formattedExtensions = configuration.documentExtensions
            .map { ".\($0)" }
            .joined(separator: ", ")
        switch configuration.documentMode {
        case .contentPackage, .folderMarker:
            return "Choose a \(formattedExtensions) document package."
        case .contentPackageOrFile:
            return "Choose a \(formattedExtensions) document package or file."
        case .fileDocument:
            return "Choose a \(formattedExtensions) document."
        }
    }

    private func usesExtensionFilteredOpenPanel(configuration: AppifyHostConfiguration) -> Bool {
        configuration.documentMode == .fileDocument || configuration.documentMode == .contentPackageOrFile
    }

    private func allowedContentTypes(configuration: AppifyHostConfiguration) -> [UTType] {
        let declaredTypes = configuration.documentContentTypes.compactMap(UTType.init)
        if !declaredTypes.isEmpty {
            return declaredTypes
        }

        return configuration.documentExtensions.compactMap { UTType(filenameExtension: $0) }
    }

    @MainActor
    private func showFatalConfigurationError(_ error: Error) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "Could Not Start App"
        alert.informativeText = String(describing: error)
        alert.runModal()
        NSApp.terminate(nil)
    }

    @MainActor
    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = message
        alert.runModal()
    }
}

final class AppifyHostInfoWindowController: NSWindowController, WKNavigationDelegate {
    private let webView: WKWebView

    init() {
        let webViewConfiguration = WKWebViewConfiguration()
        webViewConfiguration.preferences.javaScriptCanOpenWindowsAutomatically = false
        let webView = WKWebView(frame: .zero, configuration: webViewConfiguration)
        webView.allowsMagnification = true

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.minSize = NSSize(width: 640, height: 420)
        window.isReleasedWhenClosed = false
        window.isRestorable = false
        window.contentView = webView

        self.webView = webView
        super.init(window: window)
        webView.navigationDelegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("AppifyHostInfoWindowController does not support NSCoder.")
    }

    func show(title: String, url: URL) {
        window?.title = title
        showWindow(nil)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        webView.load(URLRequest(url: url))
    }

    func show(title: String, html: String, baseURL: URL?) {
        window?.title = title
        showWindow(nil)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        webView.loadHTMLString(html, baseURL: baseURL)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard navigationAction.navigationType == .linkActivated,
              let url = navigationAction.request.url
        else {
            decisionHandler(.allow)
            return
        }

        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }
}

extension AppifyHostInfoWindowController: AppifyHostWebViewReloading {
    var canReloadWebView: Bool {
        true
    }

    func reloadWebView() {
        webView.reload()
    }
}
