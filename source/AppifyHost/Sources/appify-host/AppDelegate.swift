import AppKit
import AppifyHostCore
import UniformTypeIdentifiers
import WebKit

protocol AppifyHostWebViewReloading: AnyObject {
    var canReloadWebView: Bool { get }

    func reloadWebView()
}

protocol AppifyHostWebViewInspecting: AnyObject {
    var canOpenWebInspector: Bool { get }

    func openWebInspectorFromMenu()
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSOpenSavePanelDelegate, NSMenuItemValidation, NSMenuDelegate {
    private var didReceiveDocumentOpenEvent = false
    private var configuration: AppifyHostConfiguration?
    private var helpWindowController: AppifyHostHelpWindowController?
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
                self.openDocument(at: url)
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
    @objc private func openWebInspectorFromMenu(_ sender: Any?) {
        currentWebViewInspectingController()?.openWebInspectorFromMenu()
    }

    @objc private func showAboutFromMenu(_ sender: Any?) {
        guard let configuration, let aboutNotice = configuration.aboutNotice else {
            NSApplication.shared.orderFrontStandardAboutPanel(sender)
            return
        }

        let alert = NSAlert()
        alert.messageText = "About \(configuration.appName)"
        alert.informativeText = aboutNotice.message
        alert.addButton(withTitle: "OK")

        if aboutNotice.linkURL != nil {
            alert.addButton(withTitle: aboutNotice.linkTitle ?? "Open Link")
        }

        let response = alert.runModal()
        if response == .alertSecondButtonReturn,
           let linkURL = aboutNotice.linkURL,
           let url = URL(string: linkURL) {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func showConfiguredHelpFromMenu(_ sender: Any?) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let configuration = self.configuration, let help = configuration.firstLaunchHelp else {
                return
            }
            self.showHelpWindow(help)
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
    private func showOpenPanel() {
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
            openDocument(at: url)
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
    private func openDocument(at url: URL) {
        guard let configuration else {
            showAlert(title: "Could Not Open Document", message: "The app configuration is not loaded.")
            return
        }

        do {
            let documentURL = try PackageDocument.documentURL(forPackage: url, configuration: configuration)
            if let existingDocument = existingOpenDocument(at: documentURL) {
                noteRecentDocument(at: documentURL)
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
        if let help = configuration.firstLaunchHelp {
            let helpItem = helpMenu.addItem(
                withTitle: help.windowTitle,
                action: #selector(showConfiguredHelpFromMenu(_:)),
                keyEquivalent: "?"
            )
            helpItem.target = self
        } else {
            helpMenu.addItem(withTitle: "\(configuration.appName) Help", action: #selector(NSApplication.showHelp(_:)), keyEquivalent: "?")
        }
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
        showHelpWindow(help)
    }

    private func firstLaunchHelpDefaultsKey(
        configuration: AppifyHostConfiguration,
        help: AppifyHostFirstLaunchHelp
    ) -> String {
        "AppifyHost.FirstLaunchHelp.\(configuration.bundleIdentifier).\(help.url.absoluteString)"
    }

    @MainActor
    private func showHelpWindow(_ help: AppifyHostFirstLaunchHelp) {
        let controller = helpWindowController ?? AppifyHostHelpWindowController()
        helpWindowController = controller
        controller.show(title: help.windowTitle, url: help.url)
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

final class AppifyHostHelpWindowController: NSWindowController {
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
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("AppifyHostHelpWindowController does not support NSCoder.")
    }

    func show(title: String, url: URL) {
        window?.title = title
        showWindow(nil)
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        webView.load(URLRequest(url: url))
    }
}

extension AppifyHostHelpWindowController: AppifyHostWebViewReloading {
    var canReloadWebView: Bool {
        true
    }

    func reloadWebView() {
        webView.reload()
    }
}
