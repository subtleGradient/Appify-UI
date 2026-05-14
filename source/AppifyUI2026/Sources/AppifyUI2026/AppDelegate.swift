import AppKit
import UniformTypeIdentifiers

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var documentControllers: [ObjectIdentifier: DocumentWindowController] = [:]
    private var didReceiveDocumentOpenEvent = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMainMenu()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self, !self.didReceiveDocumentOpenEvent else {
                return
            }
            self.showOpenPanel()
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        didReceiveDocumentOpenEvent = true
        for url in urls {
            openDocument(at: url)
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    @objc private func openDocumentFromMenu(_ sender: Any?) {
        showOpenPanel()
    }

    private func showOpenPanel() {
        let panel = NSOpenPanel()
        panel.title = "Open Web App"
        panel.message = "Choose a .webapp document package."
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        if let webappType = UTType(filenameExtension: "webapp") {
            panel.allowedContentTypes = [webappType]
        }

        guard panel.runModal() == .OK else {
            return
        }

        didReceiveDocumentOpenEvent = true
        for url in panel.urls {
            openDocument(at: url)
        }
    }

    private func openDocument(at url: URL) {
        let controller = DocumentWindowController(documentURL: url)
        let identifier = ObjectIdentifier(controller)
        documentControllers[identifier] = controller
        controller.onClose = { [weak self, weak controller] in
            guard let controller else {
                return
            }
            self?.documentControllers.removeValue(forKey: ObjectIdentifier(controller))
        }
        controller.showAndStart()
    }

    private func configureMainMenu() {
        let mainMenu = NSMenu()
        NSApp.mainMenu = mainMenu

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)

        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(
            withTitle: "Quit Appify UI",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )

        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)

        let fileMenu = NSMenu(title: "File")
        fileMenuItem.submenu = fileMenu
        fileMenu.addItem(
            withTitle: "Open...",
            action: #selector(openDocumentFromMenu(_:)),
            keyEquivalent: "o"
        )
    }
}
