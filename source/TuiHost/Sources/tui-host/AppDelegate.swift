import AppKit
import TuiHostCore
import UniformTypeIdentifiers

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windowControllers: [ObjectIdentifier: TerminalWindowController] = [:]
    private var didReceiveDocumentOpenEvent = false
    private var configuration: TuiHostConfiguration?

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            configuration = try loadConfiguration()
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
        guard let configuration else {
            return
        }

        let panel = NSOpenPanel()
        panel.title = "New \(configuration.windowTitlePrefix) Window"
        panel.message = "Choose any folder. \(configuration.appName) will run in that folder."
        panel.prompt = "Open"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false

        guard panel.runModal() == .OK, let folderURL = panel.url else {
            return
        }

        do {
            let packageURL = PackageDocument.packageURL(forFolder: folderURL, configuration: configuration)
            try createPackageIfNeeded(at: packageURL, configuration: configuration)
            didReceiveDocumentOpenEvent = true
            openPackage(at: packageURL)
        } catch {
            showAlert(title: "Could Not Create \(configuration.appName) Package", message: String(describing: error))
        }
    }

    @MainActor
    private func showPackagePicker() {
        guard let configuration else {
            return
        }

        let panel = NSOpenPanel()
        panel.title = "Open \(configuration.appName) Package"
        panel.message = openPanelMessage(configuration: configuration)
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        let allowedTypes = configuration.documentExtensions.compactMap { UTType(filenameExtension: $0) }
        if !allowedTypes.isEmpty {
            panel.allowedContentTypes = allowedTypes
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
        guard let configuration else {
            return
        }

        let controller = TerminalWindowController(configuration: configuration, packageURL: url)
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

    private func createPackageIfNeeded(at packageURL: URL, configuration: TuiHostConfiguration) throws {
        if FileManager.default.fileExists(atPath: packageURL.path) {
            _ = try PackageDocument.workingDirectory(forPackage: packageURL, configuration: configuration)
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
            withTitle: "Quit \(configuration.appName)",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )

        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)

        let fileMenu = NSMenu(title: "File")
        fileMenuItem.submenu = fileMenu
        let newItem = fileMenu.addItem(
            withTitle: "New \(configuration.windowTitlePrefix) Window...",
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

    private func loadConfiguration() throws -> TuiHostConfiguration {
        let environment = ProcessInfo.processInfo.environment
        let bundleURL: URL
        if let bundlePath = environment["TUI_HOST_BUNDLE_PATH"], !bundlePath.isEmpty {
            bundleURL = URL(fileURLWithPath: bundlePath, isDirectory: true)
        } else {
            bundleURL = Bundle.main.bundleURL
        }

        return try TuiHostConfigurationLoader.load(bundleURL: bundleURL, environment: environment)
    }

    private func openPanelMessage(configuration: TuiHostConfiguration) -> String {
        let formattedExtensions = configuration.documentExtensions
            .map { ".\($0)" }
            .joined(separator: ", ")
        return "Choose a \(formattedExtensions) document package."
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
}
