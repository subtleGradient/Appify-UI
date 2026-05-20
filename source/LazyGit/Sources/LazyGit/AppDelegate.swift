import AppKit
import LazyGitCore
import UniformTypeIdentifiers

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windowControllers: [ObjectIdentifier: TerminalWindowController] = [:]
    private var didReceiveDocumentOpenEvent = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.async { [weak self] in
            self?.configureMainMenu()
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self, !self.didReceiveDocumentOpenEvent else {
                return
            }
            self.showFolderPicker()
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                return
            }
            self.didReceiveDocumentOpenEvent = true
            for url in urls {
                self.openPackage(at: url)
            }
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    @objc private func newWindowFromMenu(_ sender: Any?) {
        DispatchQueue.main.async { [weak self] in
            self?.showFolderPicker()
        }
    }

    @objc private func openPackageFromMenu(_ sender: Any?) {
        DispatchQueue.main.async { [weak self] in
            self?.showPackagePicker()
        }
    }

    @MainActor
    private func showFolderPicker() {
        let panel = NSOpenPanel()
        panel.title = "New LazyGit Window"
        panel.message = "Choose any folder. LazyGit will run in that folder."
        panel.prompt = "Open"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false

        guard panel.runModal() == .OK, let folderURL = panel.url else {
            return
        }

        do {
            let packageURL = LazyGitPackage.packageURL(forFolder: folderURL)
            try createPackageIfNeeded(at: packageURL)
            didReceiveDocumentOpenEvent = true
            openPackage(at: packageURL)
        } catch {
            showAlert(title: "Could Not Create LazyGit Package", message: String(describing: error))
        }
    }

    @MainActor
    private func showPackagePicker() {
        let panel = NSOpenPanel()
        panel.title = "Open LazyGit Package"
        panel.message = "Choose a .lazygit document package."
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        if let lazygitType = UTType(filenameExtension: LazyGitPackage.pathExtension) {
            panel.allowedContentTypes = [lazygitType]
        }

        guard panel.runModal() == .OK else {
            return
        }

        didReceiveDocumentOpenEvent = true
        for url in panel.urls {
            openPackage(at: url)
        }
    }

    @MainActor
    private func openPackage(at url: URL) {
        let controller = TerminalWindowController(packageURL: url)
        let identifier = ObjectIdentifier(controller)
        windowControllers[identifier] = controller
        controller.onClose = { [weak self, weak controller] in
            guard let controller else {
                return
            }
            self?.windowControllers.removeValue(forKey: ObjectIdentifier(controller))
        }
        controller.showAndStart()
    }

    private func createPackageIfNeeded(at packageURL: URL) throws {
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: packageURL.path, isDirectory: &isDirectory) {
            guard isDirectory.boolValue else {
                throw LazyGitCoreError.invalidPackage("\(packageURL.lastPathComponent) already exists and is not a folder.")
            }
            return
        }

        try FileManager.default.createDirectory(at: packageURL, withIntermediateDirectories: false)
    }

    @MainActor
    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }

    @MainActor
    private func configureMainMenu() {
        let mainMenu = NSMenu()
        NSApp.mainMenu = mainMenu

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)

        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(
            withTitle: "Quit LazyGit",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )

        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)

        let fileMenu = NSMenu(title: "File")
        fileMenuItem.submenu = fileMenu
        let newItem = fileMenu.addItem(
            withTitle: "New LazyGit Window...",
            action: #selector(newWindowFromMenu(_:)),
            keyEquivalent: "n"
        )
        newItem.target = self

        let openItem = fileMenu.addItem(
            withTitle: "Open Package...",
            action: #selector(openPackageFromMenu(_:)),
            keyEquivalent: "o"
        )
        openItem.target = self
    }
}
