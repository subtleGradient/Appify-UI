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
    case invalidManifest(String)
    case parseError(line: Int, String)
    case untrustedPackage(String)
    case unsafeRunnerToken(String)
    case missingBun(String)
    case invalidOpenURL(String)

    public var description: String {
        switch self {
        case .invalidManifest(let message):
            "Invalid webapp.toml: \(message)"
        case .parseError(let line, let message):
            "Could not parse webapp.toml line \(line): \(message)"
        case .untrustedPackage(let package):
            "Runner package is not trusted: \(package)"
        case .unsafeRunnerToken(let token):
            "Runner token is not allowed: \(token)"
        case .missingBun(let message):
            "Bun was not found: \(message)"
        case .invalidOpenURL(let message):
            "Runner produced an unsafe open URL: \(message)"
        }
    }
}

public enum WebappManifestLoader {
    public static let manifestFileName = "webapp.toml"

    public static func load(from documentURL: URL) throws -> WebappManifest {
        let manifestURL = documentURL.appendingPathComponent(manifestFileName, isDirectory: false)
        do {
            let source = try String(contentsOf: manifestURL, encoding: .utf8)
            return try parse(source)
        } catch let error as AppifyCoreError {
            throw error
        } catch {
            throw AppifyCoreError.invalidManifest("Could not read \(manifestFileName): \(error.localizedDescription)")
        }
    }

    public static func parse(_ source: String) throws -> WebappManifest {
        let table = try TinyTOML.parse(source)

        let type = try table.requiredString("type")
        guard type == "appify.webapp" else {
            throw AppifyCoreError.invalidManifest("type must be \"appify.webapp\"")
        }

        let version = try table.requiredInt("version")
        guard version == 1 else {
            throw AppifyCoreError.invalidManifest("version must be 1")
        }

        let package = try table.requiredString("runner.package")
        try validateTrustedPackage(package)

        let bin = try table.requiredString("runner.bin")
        try validateBinToken(bin)

        let args = try table.optionalStringArray("runner.args") ?? []
        try args.forEach(validateArgToken)

        return WebappManifest(
            type: type,
            version: version,
            title: try table.optionalString("title"),
            runner: RunnerManifest(package: package, bin: bin, args: args)
        )
    }

    public static func validateTrustedPackage(_ package: String) throws {
        let prefix = "github:subtleGradient/"
        guard package.hasPrefix(prefix) else {
            throw AppifyCoreError.untrustedPackage(package)
        }

        let remainder = String(package.dropFirst(prefix.count))
        let parts = remainder.split(separator: "#", omittingEmptySubsequences: false)
        guard parts.count == 2 else {
            throw AppifyCoreError.untrustedPackage(package)
        }

        let repository = String(parts[0])
        let commit = String(parts[1])
        guard isValidRepositoryName(repository), isFullCommitSHA(commit) else {
            throw AppifyCoreError.untrustedPackage(package)
        }
    }

    public static func validateBinToken(_ token: String) throws {
        guard !token.isEmpty,
              token != ".",
              token != "..",
              token.first?.isASCIIAlphaNumeric == true,
              token.allSatisfy({ $0.isASCIIAlphaNumeric || $0 == "." || $0 == "_" || $0 == "-" })
        else {
            throw AppifyCoreError.unsafeRunnerToken(token)
        }
    }

    public static func validateArgToken(_ token: String) throws {
        guard !token.isEmpty,
              token.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              token.allSatisfy({ $0.isSafeArgumentCharacter })
        else {
            throw AppifyCoreError.unsafeRunnerToken(token)
        }
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
        try WebappManifestLoader.validateTrustedPackage(manifest.runner.package)
        try WebappManifestLoader.validateBinToken(manifest.runner.bin)
        try manifest.runner.args.forEach(WebappManifestLoader.validateArgToken)

        let documentPath = documentURL.standardizedFileURL.path
        let arguments = [
            "x",
            "--bun",
            "--package",
            manifest.runner.package,
            manifest.runner.bin,
        ] + manifest.runner.args + [documentPath]

        return RunnerCommand(executableURL: bunURL, arguments: arguments)
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
        if let override = environment["APPIFY_BUN"], !override.isEmpty {
            let expanded = expandTilde(override)
            guard expanded.hasPrefix("/") else {
                throw AppifyCoreError.missingBun("APPIFY_BUN must be an absolute path.")
            }
            guard isExecutableFile(expanded) else {
                throw AppifyCoreError.missingBun("APPIFY_BUN is not executable at \(expanded).")
            }
            return URL(fileURLWithPath: expanded)
        }

        let commonPaths = [
            "/opt/homebrew/bin/bun",
            "/usr/local/bin/bun",
            homeDirectory.appendingPathComponent(".bun/bin/bun").path,
        ]
        if let path = commonPaths.first(where: isExecutableFile) {
            return URL(fileURLWithPath: path)
        }

        let pathEntries = environment["PATH", default: ""]
            .split(separator: ":", omittingEmptySubsequences: true)
            .map(String.init)
        for entry in pathEntries {
            let candidate = URL(fileURLWithPath: entry).appendingPathComponent("bun").path
            if isExecutableFile(candidate) {
                return URL(fileURLWithPath: candidate)
            }
        }

        throw AppifyCoreError.missingBun("Set APPIFY_BUN, install Bun in /opt/homebrew/bin, /usr/local/bin, ~/.bun/bin, or add bun to PATH.")
    }

    private func expandTilde(_ path: String) -> String {
        if path == "~" {
            return homeDirectory.path
        }
        if path.hasPrefix("~/") {
            return homeDirectory.appendingPathComponent(String(path.dropFirst(2))).path
        }
        return path
    }
}

public enum AppifyOpenURL {
    public static let outputPrefix = "APPIFY_OPEN_URL="

    public static func extract(from line: String) -> URL? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix(outputPrefix) else {
            return nil
        }
        return URL(string: String(trimmed.dropFirst(outputPrefix.count)))
    }

    public static func validate(_ url: URL, documentURL: URL) throws -> URL {
        guard let scheme = url.scheme?.lowercased() else {
            throw AppifyCoreError.invalidOpenURL("URL has no scheme.")
        }

        switch scheme {
        case "http", "https":
            guard let host = url.host(percentEncoded: false)?.lowercased(),
                  ["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"].contains(host)
            else {
                throw AppifyCoreError.invalidOpenURL("HTTP(S) URLs must point at localhost or loopback.")
            }
            return url

        case "file":
            let documentPath = normalizedDirectoryPath(documentURL)
            let filePath = url.standardizedFileURL.path
            guard filePath == documentPath || filePath.hasPrefix(documentPath + "/") else {
                throw AppifyCoreError.invalidOpenURL("file:// URLs must stay inside the .webapp package.")
            }
            return url

        default:
            throw AppifyCoreError.invalidOpenURL("Unsupported URL scheme: \(scheme).")
        }
    }

    private static func normalizedDirectoryPath(_ url: URL) -> String {
        var path = url.standardizedFileURL.path
        while path.count > 1, path.hasSuffix("/") {
            path.removeLast()
        }
        return path
    }
}

private func isValidRepositoryName(_ name: String) -> Bool {
    !name.isEmpty && name.allSatisfy { character in
        character.isASCIIAlphaNumeric || character == "." || character == "_" || character == "-"
    }
}

private func isFullCommitSHA(_ value: String) -> Bool {
    value.count == 40 && value.allSatisfy(\.isASCIIHexDigit)
}

private extension Character {
    var isASCIIAlphaNumeric: Bool {
        guard let scalar = unicodeScalars.first, unicodeScalars.count == 1 else {
            return false
        }
        return ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar) || ("0"..."9").contains(scalar)
    }

    var isASCIIHexDigit: Bool {
        guard let scalar = unicodeScalars.first, unicodeScalars.count == 1 else {
            return false
        }
        return ("a"..."f").contains(scalar) || ("A"..."F").contains(scalar) || ("0"..."9").contains(scalar)
    }

    var isSafeArgumentCharacter: Bool {
        isASCIIAlphaNumeric || [".", "_", "-", ":", "@", "/", "%", "+", "=", ","].contains(self)
    }
}
