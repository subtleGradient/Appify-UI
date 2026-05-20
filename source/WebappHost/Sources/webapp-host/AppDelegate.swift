import AppKit
import UniformTypeIdentifiers
import WebappHostCore

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var documentControllers: [ObjectIdentifier: DocumentWindowController] = [:]
    private var didReceiveDocumentOpenEvent = false
    private var configuration: WebappHostConfiguration?

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
            self.showOpenPanel()
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
        true
    }

    @objc private func openDocumentFromMenu(_ sender: Any?) {
        DispatchQueue.main.async { [weak self] in
            self?.showOpenPanel()
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
        let allowedTypes = configuration.documentExtensions.compactMap { UTType(filenameExtension: $0) }
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
        guard let configuration else {
            return
        }

        let controller = DocumentWindowController(configuration: configuration, documentURL: url)
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
        fileMenu.addItem(
            withTitle: "Open...",
            action: #selector(openDocumentFromMenu(_:)),
            keyEquivalent: "o"
        )
    }

    private func loadConfiguration() throws -> WebappHostConfiguration {
        let environment = ProcessInfo.processInfo.environment
        let bundleURL: URL
        if let bundlePath = environment["WEBAPP_HOST_BUNDLE_PATH"], !bundlePath.isEmpty {
            bundleURL = URL(fileURLWithPath: bundlePath, isDirectory: true)
        } else {
            bundleURL = Bundle.main.bundleURL
        }

        return try WebappHostConfigurationLoader.load(bundleURL: bundleURL, environment: environment)
    }

    private func openPanelMessage(configuration: WebappHostConfiguration) -> String {
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
