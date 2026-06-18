import AppKit
import AppifyHostCore
import Foundation

final class AppifyHostGateServer {
    static let directoryEnvironmentKey = "APPIFY_HOST_GATE_DIRECTORY"
    static let tokenEnvironmentKey = "APPIFY_HOST_GATE_TOKEN"

    private weak var window: NSWindow?
    private let log: (String) -> Void
    private let directoryURL: URL
    private let token: String
    private var timer: Timer?
    private var activeRequestIDs = Set<String>()

    init(window: NSWindow?, log: @escaping (String) -> Void) throws {
        self.window = window
        self.log = log
        self.token = UUID().uuidString
        self.directoryURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("AppifyHostGates", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)

        try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directoryURL.path)
    }

    var environment: [String: String] {
        [
            Self.directoryEnvironmentKey: directoryURL.path,
            Self.tokenEnvironmentKey: token,
        ]
    }

    func start() {
        guard timer == nil else {
            return
        }

        timer = Timer.scheduledTimer(withTimeInterval: 0.10, repeats: true) { [weak self] _ in
            self?.scan()
        }
        scan()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        activeRequestIDs.removeAll()
        try? FileManager.default.removeItem(at: directoryURL)
    }

    private func scan() {
        let entries = (try? FileManager.default.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )) ?? []

        for requestURL in entries where isRequestFile(requestURL) {
            handleRequestFile(requestURL)
        }
    }

    private func isRequestFile(_ url: URL) -> Bool {
        let name = url.lastPathComponent
        return name.hasPrefix("request-") && name.hasSuffix(".json")
    }

    private func handleRequestFile(_ requestURL: URL) {
        guard let data = try? Data(contentsOf: requestURL) else {
            return
        }

        let envelope: AppifyHostGateEnvelope
        do {
            envelope = try AppifyHostGateEnvelope.decode(data, expectedToken: token)
        } catch {
            log("WARN: rejected malformed AppifyHost gate request \(requestURL.lastPathComponent): \(String(describing: error))\n")
            try? FileManager.default.removeItem(at: requestURL)
            return
        }

        guard !activeRequestIDs.contains(envelope.id) else {
            return
        }
        activeRequestIDs.insert(envelope.id)

        showPrompt(for: envelope) { [weak self] approved in
            guard let self else {
                return
            }
            self.writeResponse(AppifyHostGateResponse(id: envelope.id, approved: approved))
            try? FileManager.default.removeItem(at: requestURL)
            self.activeRequestIDs.remove(envelope.id)
        }
    }

    private func showPrompt(for envelope: AppifyHostGateEnvelope, completion: @escaping (Bool) -> Void) {
        let request = envelope.request
        let alert = NSAlert()
        alert.alertStyle = alertStyle(for: request.severity)
        alert.messageText = request.title
        alert.informativeText = promptText(for: request)
        alert.addButton(withTitle: request.denyButtonTitle)
        alert.addButton(withTitle: request.approveButtonTitle)
        alert.buttons.first?.keyEquivalent = "\r"
        alert.buttons.dropFirst().first?.keyEquivalent = ""

        guard let window else {
            completion(alert.runModal() == .alertSecondButtonReturn)
            return
        }

        alert.beginSheetModal(for: window) { response in
            completion(response == .alertSecondButtonReturn)
        }
    }

    private func promptText(for request: AppifyHostGateRequest) -> String {
        if let details = request.details, !details.isEmpty {
            return "\(request.message)\n\n\(details)"
        }
        return request.message
    }

    private func alertStyle(for severity: AppifyHostGateSeverity) -> NSAlert.Style {
        switch severity {
        case .informational:
            return .informational
        case .warning:
            return .warning
        case .critical:
            return .critical
        }
    }

    private func writeResponse(_ response: AppifyHostGateResponse) {
        let responseURL = directoryURL.appendingPathComponent("response-\(response.id).json", isDirectory: false)
        let temporaryURL = directoryURL.appendingPathComponent("response-\(response.id).json.tmp", isDirectory: false)

        do {
            let data = try JSONEncoder().encode(response)
            try data.write(to: temporaryURL, options: [.atomic])
            if FileManager.default.fileExists(atPath: responseURL.path) {
                try FileManager.default.removeItem(at: responseURL)
            }
            try FileManager.default.moveItem(at: temporaryURL, to: responseURL)
        } catch {
            log("ERROR: could not write AppifyHost gate response \(response.id): \(String(describing: error))\n")
        }
    }
}
