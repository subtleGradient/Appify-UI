import AppKit
import UniformTypeIdentifiers
import WebappHostCore

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var didReceiveDocumentOpenEvent = false
    private var configuration: WebappHostConfiguration?

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            configuration = try WebappHostRuntime.loadConfiguration()
        } catch {
            showFatalConfigurationError(error)
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.configureMainMenu()
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self, !self.didReceiveDocumentOpenEvent else {
                return
            }
            self.showGettingStarted()
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

    func applicationWillTerminate(_ notification: Notification) {
        for document in NSDocumentController.shared.documents {
            (document as? WebappHostDocument)?.stopRunnerForAppTermination()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            showGettingStarted()
        }

        return true
    }

    @objc private func openDocumentFromMenu(_ sender: Any?) {
        DispatchQueue.main.async { [weak self] in
            self?.showOpenPanel()
        }
    }

    @objc private func newDocumentFromMenu(_ sender: Any?) {
        DispatchQueue.main.async { [weak self] in
            self?.showNewDocumentPanel()
        }
    }

    @MainActor
    private func showGettingStarted() {
        guard let configuration else {
            return
        }

        let alert = NSAlert()
        alert.messageText = "Start \(configuration.appName)"
        alert.informativeText = "Create a new canvas or open an existing .\(configuration.documentExtensions.first ?? "tldraw") package."
        alert.addButton(withTitle: "New Canvas")
        alert.addButton(withTitle: "Open Existing...")
        alert.addButton(withTitle: "Cancel")

        switch alert.runModal() {
        case .alertFirstButtonReturn:
            showNewDocumentPanel()
        case .alertSecondButtonReturn:
            showOpenPanel()
        default:
            return
        }
    }

    @MainActor
    private func showNewDocumentPanel() {
        guard let configuration else {
            return
        }

        let panel = NSSavePanel()
        panel.title = "New \(configuration.appName)"
        panel.message = "Choose where to save your canvas."
        panel.nameFieldStringValue = "Untitled.\(configuration.documentExtensions.first ?? "tldraw")"
        panel.canCreateDirectories = true
        let allowedTypes = allowedContentTypes(configuration: configuration)
        if !allowedTypes.isEmpty {
            panel.allowedContentTypes = allowedTypes
        }

        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }

        do {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        } catch {
            showOpenError(error)
            return
        }

        didReceiveDocumentOpenEvent = true
        openDocument(at: url)
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
        let allowedTypes = allowedContentTypes(configuration: configuration)
        if !allowedTypes.isEmpty {
            panel.allowedContentTypes = allowedTypes
        }

        guard panel.runModal() == .OK else {
            return
        }

        didReceiveDocumentOpenEvent = true
        for url in panel.urls {
            openDocument(at: url)
        }
    }

    @MainActor
    private func openDocument(at url: URL) {
        NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { [weak self] document, _, error in
            if let error {
                self?.showOpenError(error)
                return
            }

            document?.showWindows()
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
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())

        let servicesMenu = NSMenu()
        NSApp.servicesMenu = servicesMenu
        let servicesItem = appMenu.addItem(withTitle: "Services", action: nil, keyEquivalent: "")
        servicesItem.submenu = servicesMenu
        appMenu.addItem(.separator())

        appMenu.addItem(
            withTitle: "Hide \(configuration.appName)",
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h"
        )
        let hideOthersItem = appMenu.addItem(
            withTitle: "Hide Others",
            action: #selector(NSApplication.hideOtherApplications(_:)),
            keyEquivalent: "h"
        )
        hideOthersItem.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(
            withTitle: "Show All",
            action: #selector(NSApplication.unhideAllApplications(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Quit \(configuration.appName)",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )

        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)

        let fileMenu = NSMenu(title: "File")
        fileMenuItem.submenu = fileMenu
        fileMenu.addItem(
            withTitle: "New...",
            action: #selector(newDocumentFromMenu(_:)),
            keyEquivalent: "n"
        )
        fileMenu.addItem(
            withTitle: "Open...",
            action: #selector(openDocumentFromMenu(_:)),
            keyEquivalent: "o"
        )
        fileMenu.addItem(.separator())
        fileMenu.addItem(
            withTitle: "Close",
            action: #selector(NSWindow.performClose(_:)),
            keyEquivalent: "w"
        )

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
    }

    private func openPanelMessage(configuration: WebappHostConfiguration) -> String {
        let formattedExtensions = configuration.documentExtensions
            .map { ".\($0)" }
            .joined(separator: ", ")
        return "Choose a \(formattedExtensions) document package."
    }

    private func allowedContentTypes(configuration: WebappHostConfiguration) -> [UTType] {
        configuration.documentExtensions.compactMap { UTType(filenameExtension: $0) }
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
    private func showOpenError(_ error: Error) {
        let alert = NSAlert(error: error)
        alert.runModal()
    }
}
