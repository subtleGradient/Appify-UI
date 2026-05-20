import Foundation

public struct WebappHostConfiguration: Equatable, Sendable {
    public var appName: String
    public var bundleIdentifier: String
    public var bundleURL: URL
    public var documentExtensions: [String]
    public var documentKindEnvironmentValue: String
    public var runnerInstallDirectory: String
    public var runnerEntry: String
    public var runnerArguments: [String]
    public var logName: String

    public init(
        appName: String,
        bundleIdentifier: String,
        bundleURL: URL,
        documentExtensions: [String],
        documentKindEnvironmentValue: String,
        runnerInstallDirectory: String,
        runnerEntry: String,
        runnerArguments: [String],
        logName: String
    ) {
        self.appName = appName
        self.bundleIdentifier = bundleIdentifier
        self.bundleURL = bundleURL
        self.documentExtensions = documentExtensions
        self.documentKindEnvironmentValue = documentKindEnvironmentValue
        self.runnerInstallDirectory = runnerInstallDirectory
        self.runnerEntry = runnerEntry
        self.runnerArguments = runnerArguments
        self.logName = logName
    }

    public var runnerDirectoryURL: URL {
        if runnerInstallDirectory.hasPrefix("/") {
            return URL(fileURLWithPath: runnerInstallDirectory, isDirectory: true).standardizedFileURL
        }

        return bundleURL.appendingPathComponent(runnerInstallDirectory, isDirectory: true).standardizedFileURL
    }
}

public enum WebappHostError: Error, Equatable, CustomStringConvertible, Sendable {
    case missingInfoPlist(String)
    case invalidInfoPlist(String)
    case missingBun(String)
    case unsafeRunnerToken(String)
    case invalidOpenURL(String)

    public var description: String {
        switch self {
        case .missingInfoPlist(let message):
            "Missing Info.plist: \(message)"
        case .invalidInfoPlist(let message):
            "Invalid Info.plist: \(message)"
        case .missingBun(let message):
            "Bun was not found: \(message)"
        case .unsafeRunnerToken(let token):
            "Runner token is not allowed: \(token)"
        case .invalidOpenURL(let message):
            "Runner produced an unsafe open URL: \(message)"
        }
    }
}

public enum WebappHostConfigurationLoader {
    public static func load(bundleURL: URL, environment: [String: String] = ProcessInfo.processInfo.environment) throws -> WebappHostConfiguration {
        let infoURL = bundleURL.appendingPathComponent("Contents/Info.plist", isDirectory: false)
        guard let info = NSDictionary(contentsOf: infoURL) as? [String: Any] else {
            throw WebappHostError.missingInfoPlist("Could not read \(infoURL.path).")
        }

        return try load(infoDictionary: info, bundleURL: bundleURL, environment: environment)
    }

    public static func load(
        infoDictionary: [String: Any],
        bundleURL: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> WebappHostConfiguration {
        let appName = stringValue(infoDictionary["CFBundleDisplayName"])
            ?? stringValue(infoDictionary["CFBundleName"])
            ?? bundleURL.deletingPathExtension().lastPathComponent
        let bundleIdentifier = stringValue(infoDictionary["CFBundleIdentifier"])
            ?? "local.webapp-host.\(appName.replacingOccurrences(of: " ", with: "-"))"

        guard let hostSettings = infoDictionary["WebappHost"] as? [String: Any] else {
            throw WebappHostError.invalidInfoPlist("WebappHost dictionary is required.")
        }

        let runnerInstallDirectory = stringValue(hostSettings["RunnerInstallDirectory"])
            ?? "Contents/Resources/Runner"
        let runnerEntry = stringValue(hostSettings["RunnerEntry"]) ?? "src/index.ts"
        let runnerArguments = stringArrayValue(hostSettings["RunnerArguments"]) ?? []
        let documentKind = stringValue(hostSettings["DocumentKindEnvironmentValue"])
            ?? bundleIdentifier
        let logName = stringValue(hostSettings["LogName"]) ?? appName
        let documentExtensions = parseDocumentExtensions(from: infoDictionary)

        guard !documentExtensions.isEmpty else {
            throw WebappHostError.invalidInfoPlist("At least one document filename extension is required.")
        }

        try validateRunnerToken(runnerEntry)
        try runnerArguments.forEach(validateRunnerToken)

        return WebappHostConfiguration(
            appName: appName,
            bundleIdentifier: bundleIdentifier,
            bundleURL: bundleURL.standardizedFileURL,
            documentExtensions: documentExtensions,
            documentKindEnvironmentValue: documentKind,
            runnerInstallDirectory: runnerInstallDirectory,
            runnerEntry: runnerEntry,
            runnerArguments: runnerArguments,
            logName: logName
        )
    }

    public static func parseDocumentExtensions(from infoDictionary: [String: Any]) -> [String] {
        var contentTypes: [String] = []
        var extensions: [String] = []

        for documentType in arrayOfDictionaries(infoDictionary["CFBundleDocumentTypes"]) {
            contentTypes.append(contentsOf: stringArrayValue(documentType["LSItemContentTypes"]) ?? [])
            extensions.append(contentsOf: stringArrayValue(documentType["CFBundleTypeExtensions"]) ?? [])
        }

        let typeDeclarations = arrayOfDictionaries(infoDictionary["UTExportedTypeDeclarations"])
            + arrayOfDictionaries(infoDictionary["UTImportedTypeDeclarations"])

        for declaration in typeDeclarations {
            let identifier = stringValue(declaration["UTTypeIdentifier"])
            guard identifier == nil || contentTypes.isEmpty || contentTypes.contains(identifier!) else {
                continue
            }

            guard let tags = declaration["UTTypeTagSpecification"] as? [String: Any] else {
                continue
            }

            if let tagExtensions = stringArrayValue(tags["public.filename-extension"]) {
                extensions.append(contentsOf: tagExtensions)
            }
        }

        var seen = Set<String>()
        return extensions.compactMap { value in
            let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingPrefix(".")
                .lowercased()
            guard !normalized.isEmpty, !seen.contains(normalized) else {
                return nil
            }
            seen.insert(normalized)
            return normalized
        }
    }
}

public struct RunnerCommand: Equatable, Sendable {
    public var executableURL: URL
    public var currentDirectoryURL: URL
    public var arguments: [String]

    public init(executableURL: URL, currentDirectoryURL: URL, arguments: [String]) {
        self.executableURL = executableURL
        self.currentDirectoryURL = currentDirectoryURL
        self.arguments = arguments
    }
}

public enum RunnerCommandBuilder {
    public static func command(
        bunURL: URL,
        configuration: WebappHostConfiguration,
        documentURL: URL
    ) throws -> RunnerCommand {
        try WebappHostConfigurationLoader.validateRunnerToken(configuration.runnerEntry)
        try configuration.runnerArguments.forEach(WebappHostConfigurationLoader.validateRunnerToken)

        let documentPath = documentURL.standardizedFileURL.path
        let arguments = [
            configuration.runnerEntry,
        ] + configuration.runnerArguments + [
            documentPath,
        ]

        return RunnerCommand(
            executableURL: bunURL,
            currentDirectoryURL: configuration.runnerDirectoryURL,
            arguments: arguments
        )
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
        for key in ["WEBAPP_HOST_BUN", "APPIFY_BUN"] {
            if let override = environment[key], !override.isEmpty {
                let expanded = expandTilde(override)
                guard expanded.hasPrefix("/") else {
                    throw WebappHostError.missingBun("\(key) must be an absolute path.")
                }
                guard isExecutableFile(expanded) else {
                    throw WebappHostError.missingBun("\(key) is not executable at \(expanded).")
                }
                return URL(fileURLWithPath: expanded)
            }
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

        throw WebappHostError.missingBun("Install Bun or set WEBAPP_HOST_BUN to an executable Bun path.")
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

public enum WebappHostOpenURL {
    public static let outputPrefixes = [
        "WEBAPP_HOST_OPEN_URL=",
        "APPIFY_OPEN_URL=",
    ]

    public static func extract(from line: String) -> URL? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        for prefix in outputPrefixes {
            if trimmed.hasPrefix(prefix) {
                return URL(string: String(trimmed.dropFirst(prefix.count)))
            }
        }

        return firstURL(in: trimmed)
    }

    public static func validate(_ url: URL, documentURL: URL, bundleURL: URL) throws -> URL {
        guard let scheme = url.scheme?.lowercased() else {
            throw WebappHostError.invalidOpenURL("URL has no scheme.")
        }

        switch scheme {
        case "http", "https":
            guard let host = url.host(percentEncoded: false)?.lowercased(),
                  ["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"].contains(host)
            else {
                throw WebappHostError.invalidOpenURL("HTTP(S) URLs must point at localhost or loopback.")
            }
            return url

        case "file":
            let allowedDirectories = [
                normalizedDirectoryPath(documentURL),
                normalizedDirectoryPath(bundleURL),
            ]
            let filePath = url.standardizedFileURL.path
            guard allowedDirectories.contains(where: { filePath == $0 || filePath.hasPrefix($0 + "/") }) else {
                throw WebappHostError.invalidOpenURL("file:// URLs must stay inside the document package or app bundle.")
            }
            return url

        default:
            throw WebappHostError.invalidOpenURL("Unsupported URL scheme: \(scheme).")
        }
    }

    private static func firstURL(in text: String) -> URL? {
        let schemes = ["http://", "https://", "file://"]
        let ranges = schemes.compactMap { scheme in
            text.range(of: scheme, options: [.caseInsensitive])
        }
        guard let start = ranges.map(\.lowerBound).min() else {
            return nil
        }

        var end = start
        while end < text.endIndex, !text[end].isWhitespace {
            text.formIndex(after: &end)
        }

        var candidate = String(text[start..<end])
        while let last = candidate.last, "'\"),]}".contains(last) {
            candidate.removeLast()
        }

        return URL(string: candidate)
    }

    private static func normalizedDirectoryPath(_ url: URL) -> String {
        var path = url.standardizedFileURL.path
        while path.count > 1, path.hasSuffix("/") {
            path.removeLast()
        }
        return path
    }
}

private func stringValue(_ value: Any?) -> String? {
    value as? String
}

private func stringArrayValue(_ value: Any?) -> [String]? {
    if let array = value as? [String] {
        return array
    }
    if let string = value as? String {
        return [string]
    }
    return nil
}

private func arrayOfDictionaries(_ value: Any?) -> [[String: Any]] {
    value as? [[String: Any]] ?? []
}

private extension String {
    func trimmingPrefix(_ prefix: String) -> String {
        hasPrefix(prefix) ? String(dropFirst(prefix.count)) : self
    }
}

private extension Character {
    var isASCIIAlphaNumeric: Bool {
        guard let scalar = unicodeScalars.first, unicodeScalars.count == 1 else {
            return false
        }
        return ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar) || ("0"..."9").contains(scalar)
    }

    var isSafeRunnerCharacter: Bool {
        isASCIIAlphaNumeric || [".", "_", "-", ":", "@", "/", "%", "+", "=", ","].contains(self)
    }
}

public extension WebappHostConfigurationLoader {
    static func validateRunnerToken(_ token: String) throws {
        guard !token.isEmpty,
              token != ".",
              token != "..",
              !token.hasPrefix("/"),
              !token.contains(".."),
              token.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              token.allSatisfy(\.isSafeRunnerCharacter)
        else {
            throw WebappHostError.unsafeRunnerToken(token)
        }
    }
}
