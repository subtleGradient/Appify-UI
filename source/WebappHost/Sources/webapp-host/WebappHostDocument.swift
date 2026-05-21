import AppKit

@objc(WebappHostDocument)
final class WebappHostDocument: NSDocument {
    private var hostWindowController: DocumentWindowController?

    override class var autosavesInPlace: Bool {
        true
    }

    override var isDocumentEdited: Bool {
        false
    }

    override var fileURL: URL? {
        didSet {
            hostWindowController?.documentURLDidChange()
        }
    }

    override init() {
        super.init()
    }

    override func read(from url: URL, ofType typeName: String) throws {
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
                    NSLocalizedDescriptionKey: "Expected a .tldraw document package.",
                ]
            )
        }
    }

    override func write(to url: URL, ofType typeName: String) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    override func makeWindowControllers() {
        do {
            let controller = DocumentWindowController(
                configuration: try WebappHostRuntime.requireConfiguration(),
                document: self
            )
            hostWindowController = controller
            addWindowController(controller)
            controller.showAndStart()
        } catch {
            presentError(error)
        }
    }

    func stopRunnerForAppTermination() {
        hostWindowController?.stopForAppTermination()
    }

    override func presentedItemDidMove(to newURL: URL) {
        super.presentedItemDidMove(to: newURL)
        hostWindowController?.documentURLDidChange()
    }
}
