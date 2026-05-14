import Foundation

public struct WebappManifest: Equatable, Sendable {
    public var type: String
    public var version: Int
    public var title: String?
    public var runner: RunnerManifest

    public init(type: String, version: Int, title: String?, runner: RunnerManifest) {
        self.type = type
        self.version = version
        self.title = title
        self.runner = runner
    }
}

public struct RunnerManifest: Equatable, Sendable {
    public var package: String
    public var bin: String
    public var args: [String]

    public init(package: String, bin: String, args: [String]) {
        self.package = package
        self.bin = bin
        self.args = args
    }
}

public enum AppifyCoreError: Error, Equatable, CustomStringConvertible, Sendable {
    case notImplemented

    public var description: String {
        switch self {
        case .notImplemented:
            "Not implemented"
        }
    }
}

public enum WebappManifestLoader {
    public static func parse(_ source: String) throws -> WebappManifest {
        throw AppifyCoreError.notImplemented
    }
}

public struct RunnerCommand: Equatable, Sendable {
    public var executableURL: URL
    public var arguments: [String]

    public init(executableURL: URL, arguments: [String]) {
        self.executableURL = executableURL
        self.arguments = arguments
    }
}

public enum RunnerCommandBuilder {
    public static func command(bunURL: URL, manifest: WebappManifest, documentURL: URL) throws -> RunnerCommand {
        throw AppifyCoreError.notImplemented
    }
}

public struct BunResolver: Sendable {
    public var environment: [String: String]
    public var homeDirectory: URL
    public var isExecutableFile: @Sendable (String) -> Bool

    public init(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser,
        isExecutableFile: @escaping @Sendable (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) }
    ) {
        self.environment = environment
        self.homeDirectory = homeDirectory
        self.isExecutableFile = isExecutableFile
    }

    public func resolve() throws -> URL {
        throw AppifyCoreError.notImplemented
    }
}

public enum AppifyOpenURL {
    public static let outputPrefix = "APPIFY_OPEN_URL="

    public static func extract(from line: String) -> URL? {
        nil
    }

    public static func validate(_ url: URL, documentURL: URL) throws -> URL {
        throw AppifyCoreError.notImplemented
    }
}
