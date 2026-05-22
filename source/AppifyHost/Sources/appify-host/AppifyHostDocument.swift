import AppKit
import AppifyHostCore

@objc(AppifyHostDocument)
final class AppifyHostDocument: NSDocument {
    private var hostWindowController: HostWindowController?
    private var temporaryDocumentURL: URL?

    override class var autosavesInPlace: Bool {
        true
    }

    override var isDocumentEdited: Bool {
        temporaryDocumentURL != nil && fileURL == nil
    }

    var activeDocumentURL: URL? {
        fileURL?.standardizedFileURL ?? temporaryDocumentURL?.standardizedFileURL
    }

    override var fileURL: URL? {
        didSet {
            if fileURL != nil {
                temporaryDocumentURL = nil
            }
            hostWindowController?.documentURLDidChange()
        }
    }

    override init() {
        super.init()
    }

    @IBAction override func save(_ sender: Any?) {
        flushWebDocumentBeforeNativeSave { [weak self] in
            self?.performNativeSave(sender)
        }
    }

    @IBAction override func saveAs(_ sender: Any?) {
        flushWebDocumentBeforeNativeSave { [weak self] in
            self?.performNativeSaveAs(sender)
        }
    }

    func configureUntitledDocument(at url: URL) {
        temporaryDocumentURL = url.standardizedFileURL
    }

    override func read(from url: URL, ofType typeName: String) throws {
        let configuration = try AppifyHostRuntime.requireConfiguration()
        switch configuration.documentMode {
        case .contentPackage, .folderMarker:
            try ensurePackageExists(at: url)
        case .fileDocument:
            break
        }
        try PackageDocument.validatePackageURL(url, configuration: configuration)
    }

    override func write(to url: URL, ofType typeName: String) throws {
        let configuration = try AppifyHostRuntime.requireConfiguration()
        switch configuration.documentMode {
        case .contentPackage:
            try writeContentPackage(to: url)
        case .folderMarker:
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        case .fileDocument:
            try writeFileDocument(to: url)
        }
    }

    override func makeWindowControllers() {
        guard let activeDocumentURL else {
            DispatchQueue.main.async { [weak self] in
                self?.close()
            }
            return
        }

        do {
            let controller = HostWindowController(
                configuration: try AppifyHostRuntime.requireConfiguration(),
                document: self
            )
            hostWindowController = controller
            addWindowController(controller)
            controller.showAndStart(documentURL: activeDocumentURL)
        } catch {
            presentError(error)
        }
    }

    func stopServerForAppTermination() {
        hostWindowController?.stopForAppTermination()
    }

    private func flushWebDocumentBeforeNativeSave(_ nativeSave: @escaping () -> Void) {
        guard let hostWindowController else {
            nativeSave()
            return
        }

        hostWindowController.flushWebDocumentSave { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    nativeSave()
                case .failure(let error):
                    self?.presentError(error)
                }
            }
        }
    }

    private func performNativeSave(_ sender: Any?) {
        super.save(sender)
    }

    private func performNativeSaveAs(_ sender: Any?) {
        super.saveAs(sender)
    }

    override func close() {
        let disposableURL = temporaryDocumentURL
        stopServerForAppTermination()
        super.close()
        if let disposableURL {
            try? FileManager.default.removeItem(at: disposableURL)
        }
    }

    override func presentedItemDidMove(to newURL: URL) {
        super.presentedItemDidMove(to: newURL)
        hostWindowController?.documentURLDidChange()
    }

    private func ensurePackageExists(at url: URL) throws {
        var isDirectory: ObjCBool = false
        if !FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            return
        }

        guard isDirectory.boolValue else {
            throw NSError(
                domain: NSCocoaErrorDomain,
                code: CocoaError.Code.fileReadCorruptFile.rawValue,
                userInfo: [
                    NSLocalizedDescriptionKey: "Expected a document package.",
                ]
            )
        }
    }

    private func writeContentPackage(to url: URL) throws {
        guard let activeDocumentURL else {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            return
        }

        let source = activeDocumentURL.standardizedFileURL
        let destination = url.standardizedFileURL
        if source == destination {
            try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
            return
        }

        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.copyItem(at: source, to: destination)
    }

    private func writeFileDocument(to url: URL) throws {
        guard let activeDocumentURL else {
            if !FileManager.default.fileExists(atPath: url.path) {
                _ = FileManager.default.createFile(atPath: url.path, contents: Data())
            }
            return
        }

        let source = activeDocumentURL.standardizedFileURL
        let destination = url.standardizedFileURL
        if source == destination {
            return
        }

        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.copyItem(at: source, to: destination)
    }
}
