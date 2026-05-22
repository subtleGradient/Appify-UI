import Foundation

public struct AppifyHostConfiguration: Equatable, Sendable {
    public var appName: String
    public var bundleIdentifier: String
    public var bundleURL: URL
    public var documentExtensions: [String]
    public var documentContentTypes: [String]
    public var documentClassName: String?
    public var documentMode: AppifyHostDocumentMode
    public var documentKindEnvironmentValue: String
    public var serverInstallDirectory: String
    public var serverExecutable: String
    public var serverArguments: [String]
    public var environmentVariables: [String: String]
    public var logName: String
    public var windowTitlePrefix: String
    public var startupTimeoutSeconds: TimeInterval
    public var webViewDataStore: AppifyHostWebViewDataStore
    public var restrictNavigationToReadyURLScope: Bool
    public var aboutNotice: AppifyHostAboutNotice?
    public var firstLaunchHelp: AppifyHostFirstLaunchHelp?

    public init(
        appName: String,
        bundleIdentifier: String,
        bundleURL: URL,
        documentExtensions: [String],
        documentContentTypes: [String],
        documentClassName: String?,
        documentMode: AppifyHostDocumentMode,
        documentKindEnvironmentValue: String,
        serverInstallDirectory: String,
        serverExecutable: String,
        serverArguments: [String],
        environmentVariables: [String: String],
        logName: String,
        windowTitlePrefix: String,
        startupTimeoutSeconds: TimeInterval,
        webViewDataStore: AppifyHostWebViewDataStore,
        restrictNavigationToReadyURLScope: Bool,
        aboutNotice: AppifyHostAboutNotice?,
        firstLaunchHelp: AppifyHostFirstLaunchHelp?
    ) {
        self.appName = appName
        self.bundleIdentifier = bundleIdentifier
        self.bundleURL = bundleURL
        self.documentExtensions = documentExtensions
        self.documentContentTypes = documentContentTypes
        self.documentClassName = documentClassName
        self.documentMode = documentMode
        self.documentKindEnvironmentValue = documentKindEnvironmentValue
        self.serverInstallDirectory = serverInstallDirectory
        self.serverExecutable = serverExecutable
        self.serverArguments = serverArguments
        self.environmentVariables = environmentVariables
        self.logName = logName
        self.windowTitlePrefix = windowTitlePrefix
        self.startupTimeoutSeconds = startupTimeoutSeconds
        self.webViewDataStore = webViewDataStore
        self.restrictNavigationToReadyURLScope = restrictNavigationToReadyURLScope
        self.aboutNotice = aboutNotice
        self.firstLaunchHelp = firstLaunchHelp
    }

    public var primaryDocumentExtension: String {
        documentExtensions.first ?? "appify"
    }

    public var serverDirectoryURL: URL {
        if serverInstallDirectory.hasPrefix("/") {
            return URL(fileURLWithPath: serverInstallDirectory, isDirectory: true).standardizedFileURL
        }

        return bundleURL.appendingPathComponent(serverInstallDirectory, isDirectory: true).standardizedFileURL
    }

    public var serverExecutableURL: URL {
        serverDirectoryURL.appendingPathComponent(serverExecutable, isDirectory: false).standardizedFileURL
    }
}

public enum AppifyHostDocumentMode: String, Equatable, Sendable {
    case contentPackage
    case folderMarker
    case fileDocument
}

public enum AppifyHostWebViewDataStore: String, Equatable, Sendable {
    case persistent
    case nonPersistent
}

public struct AppifyHostAboutNotice: Equatable, Sendable {
    public var message: String
    public var linkTitle: String?
    public var linkURL: String?

    public init(message: String, linkTitle: String?, linkURL: String?) {
        self.message = message
        self.linkTitle = linkTitle
        self.linkURL = linkURL
    }
}

public struct AppifyHostFirstLaunchHelp: Equatable, Sendable {
    public var url: URL
    public var windowTitle: String

    public init(url: URL, windowTitle: String) {
        self.url = url
        self.windowTitle = windowTitle
    }
}

public enum AppifyHostError: Error, Equatable, CustomStringConvertible, Sendable {
    case missingInfoPlist(String)
    case invalidInfoPlist(String)
    case invalidPackage(String)
    case unsafeConfigurationToken(String)
    case invalidOpenURL(String)

    public var description: String {
        switch self {
        case .missingInfoPlist(let message):
            "Missing Info.plist: \(message)"
        case .invalidInfoPlist(let message):
            "Invalid Info.plist: \(message)"
        case .invalidPackage(let message):
            "Invalid package: \(message)"
        case .unsafeConfigurationToken(let token):
            "AppifyHost configuration token is not allowed: \(token)"
        case .invalidOpenURL(let message):
            "Server produced an unsafe open URL: \(message)"
        }
    }
}

public enum AppifyHostConfigurationLoader {
    public static func load(
        bundleURL: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> AppifyHostConfiguration {
        let infoURL = bundleURL.appendingPathComponent("Contents/Info.plist", isDirectory: false)
        guard let info = NSDictionary(contentsOf: infoURL) as? [String: Any] else {
            throw AppifyHostError.missingInfoPlist("Could not read \(infoURL.path).")
        }

        return try load(infoDictionary: info, bundleURL: bundleURL, environment: environment)
    }

    public static func load(
        infoDictionary: [String: Any],
        bundleURL: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> AppifyHostConfiguration {
        let appName = stringValue(infoDictionary["CFBundleDisplayName"])
            ?? stringValue(infoDictionary["CFBundleName"])
            ?? bundleURL.deletingPathExtension().lastPathComponent
        let bundleIdentifier = stringValue(infoDictionary["CFBundleIdentifier"])
            ?? "local.appify-host.\(appName.replacingOccurrences(of: " ", with: "-"))"

        guard let hostSettings = infoDictionary["AppifyHost"] as? [String: Any] else {
            throw AppifyHostError.invalidInfoPlist("AppifyHost dictionary is required.")
        }

        let documentModeValue = stringValue(hostSettings["DocumentMode"]) ?? AppifyHostDocumentMode.contentPackage.rawValue
        guard let documentMode = AppifyHostDocumentMode(rawValue: documentModeValue) else {
            throw AppifyHostError.invalidInfoPlist("Unsupported AppifyHost:DocumentMode: \(documentModeValue).")
        }

        let webViewDataStoreValue = stringValue(hostSettings["WebViewDataStore"]) ?? AppifyHostWebViewDataStore.persistent.rawValue
        guard let webViewDataStore = AppifyHostWebViewDataStore(rawValue: webViewDataStoreValue) else {
            throw AppifyHostError.invalidInfoPlist("Unsupported AppifyHost:WebViewDataStore: \(webViewDataStoreValue).")
        }

        let documentContentTypes = parseDocumentContentTypes(from: infoDictionary)
        let documentExtensions = parseDocumentExtensions(from: infoDictionary)
        let documentKind = stringValue(hostSettings["DocumentKindEnvironmentValue"])
            ?? bundleIdentifier
        let documentClassName = parseDocumentClassName(from: infoDictionary, documentKind: documentKind)
        let serverInstallDirectory = stringValue(hostSettings["ServerInstallDirectory"])
            ?? "Contents/Resources/AppServer"
        let serverExecutable = stringValue(hostSettings["ServerExecutable"]) ?? "main.sh"
        let serverArguments = stringArrayValue(hostSettings["ServerArguments"]) ?? []
        let environmentVariables = stringDictionaryValue(hostSettings["EnvironmentVariables"]) ?? [:]
        let logName = stringValue(hostSettings["LogName"]) ?? appName
        let windowTitlePrefix = stringValue(hostSettings["WindowTitlePrefix"]) ?? appName
        let startupTimeoutSeconds: TimeInterval
        if hostSettings.keys.contains("StartupTimeoutSeconds") {
            guard let configuredTimeout = positiveTimeIntervalValue(hostSettings["StartupTimeoutSeconds"]) else {
                throw AppifyHostError.invalidInfoPlist("AppifyHost:StartupTimeoutSeconds must be a positive number.")
            }
            startupTimeoutSeconds = configuredTimeout
        } else {
            startupTimeoutSeconds = 20
        }
        let restrictNavigation = boolValue(hostSettings["RestrictNavigationToReadyURLScope"]) ?? true
        let aboutNotice = parseAboutNotice(from: hostSettings)
        let firstLaunchHelp = try parseFirstLaunchHelp(from: hostSettings, appName: appName)

        guard !documentExtensions.isEmpty else {
            throw AppifyHostError.invalidInfoPlist("At least one document filename extension is required.")
        }

        try validatePathToken(serverExecutable)
        try serverArguments.forEach(validateArgumentTemplate)
        try environmentVariables.keys.forEach(validateEnvironmentKey)
        try environmentVariables.values.forEach(validateEnvironmentTemplate)

        return AppifyHostConfiguration(
            appName: appName,
            bundleIdentifier: bundleIdentifier,
            bundleURL: bundleURL.standardizedFileURL,
            documentExtensions: documentExtensions,
            documentContentTypes: documentContentTypes,
            documentClassName: documentClassName,
            documentMode: documentMode,
            documentKindEnvironmentValue: documentKind,
            serverInstallDirectory: serverInstallDirectory,
            serverExecutable: serverExecutable,
            serverArguments: serverArguments,
            environmentVariables: environmentVariables,
            logName: logName,
            windowTitlePrefix: windowTitlePrefix,
            startupTimeoutSeconds: startupTimeoutSeconds,
            webViewDataStore: webViewDataStore,
            restrictNavigationToReadyURLScope: restrictNavigation,
            aboutNotice: aboutNotice,
            firstLaunchHelp: firstLaunchHelp
        )
    }

    public static func parseDocumentExtensions(from infoDictionary: [String: Any]) -> [String] {
        let contentTypes = parseDocumentContentTypes(from: infoDictionary)
        var extensions: [String] = []

        for documentType in arrayOfDictionaries(infoDictionary["CFBundleDocumentTypes"]) {
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

    public static func parseDocumentContentTypes(from infoDictionary: [String: Any]) -> [String] {
        var seen = Set<String>()
        var contentTypes: [String] = []

        for documentType in arrayOfDictionaries(infoDictionary["CFBundleDocumentTypes"]) {
            for value in stringArrayValue(documentType["LSItemContentTypes"]) ?? [] {
                let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !normalized.isEmpty, !seen.contains(normalized) else {
                    continue
                }
                seen.insert(normalized)
                contentTypes.append(normalized)
            }
        }

        return contentTypes
    }

    public static func parseDocumentClassName(from infoDictionary: [String: Any], documentKind: String) -> String? {
        for documentType in arrayOfDictionaries(infoDictionary["CFBundleDocumentTypes"]) {
            let contentTypes = stringArrayValue(documentType["LSItemContentTypes"]) ?? []
            guard contentTypes.isEmpty || contentTypes.contains(documentKind) else {
                continue
            }
            if let documentClassName = stringValue(documentType["NSDocumentClass"]), !documentClassName.isEmpty {
                return documentClassName
            }
        }

        return nil
    }

    public static func parseAboutNotice(from hostSettings: [String: Any]) -> AppifyHostAboutNotice? {
        guard let notice = hostSettings["AboutNotice"] as? [String: Any],
              let message = trimmedString(notice["Message"])
        else {
            return nil
        }

        return AppifyHostAboutNotice(
            message: message,
            linkTitle: trimmedString(notice["LinkTitle"]),
            linkURL: trimmedString(notice["LinkURL"])
        )
    }

    public static func parseFirstLaunchHelp(from hostSettings: [String: Any], appName: String) throws -> AppifyHostFirstLaunchHelp? {
        guard let help = hostSettings["FirstLaunchHelp"] as? [String: Any] else {
            return nil
        }

        guard let urlString = trimmedString(help["URL"]),
              let url = URL(string: urlString),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host(percentEncoded: false) != nil
        else {
            throw AppifyHostError.invalidInfoPlist("AppifyHost:FirstLaunchHelp:URL must be an absolute http(s) URL.")
        }

        return AppifyHostFirstLaunchHelp(
            url: url,
            windowTitle: trimmedString(help["WindowTitle"]) ?? "\(appName) Help"
        )
    }
}

public enum PackageDocument {
    public static func slug(for folderName: String, fallback: String) -> String {
        var result = ""
        var previousWasSeparator = false

        for scalar in folderName.unicodeScalars {
            if ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar) {
                result.append(Character(scalar))
                previousWasSeparator = false
            } else if ("A"..."Z").contains(scalar), let lower = UnicodeScalar(scalar.value + 32) {
                result.append(Character(lower))
                previousWasSeparator = false
            } else if !previousWasSeparator {
                result.append("-")
                previousWasSeparator = true
            }
        }

        let trimmed = result.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return trimmed.isEmpty ? fallback : trimmed
    }

    public static func packageURL(forFolder folderURL: URL, configuration: AppifyHostConfiguration) -> URL {
        let standardized = folderURL.standardizedFileURL
        let fallback = slug(for: configuration.appName, fallback: "appify")
        let baseName = slug(for: standardized.lastPathComponent, fallback: fallback)
        return standardized.appendingPathComponent("\(baseName).\(configuration.primaryDocumentExtension)", isDirectory: true)
    }

    public static func validatePackageURL(_ packageURL: URL, configuration: AppifyHostConfiguration) throws {
        _ = try documentURL(forPackage: packageURL, configuration: configuration)
    }

    public static func documentURL(forPackage packageURL: URL, configuration: AppifyHostConfiguration) throws -> URL {
        let standardized = try resolvedURL(forPackage: packageURL)
        guard standardized.isFileURL else {
            throw AppifyHostError.invalidPackage("Expected a local package.")
        }
        guard configuration.documentExtensions.contains(standardized.pathExtension.lowercased()) else {
            let expected = configuration.documentExtensions.map { ".\($0)" }.joined(separator: ", ")
            throw AppifyHostError.invalidPackage("Expected one of: \(expected).")
        }

        let values: URLResourceValues
        do {
            values = try standardized.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey])
        } catch {
            throw AppifyHostError.invalidPackage("\(standardized.lastPathComponent) is not readable.")
        }
        guard values.isSymbolicLink != true else {
            throw AppifyHostError.invalidPackage("\(standardized.lastPathComponent) must be a real document, not a symlink.")
        }

        switch configuration.documentMode {
        case .contentPackage, .folderMarker:
            guard values.isDirectory == true else {
                throw AppifyHostError.invalidPackage("\(standardized.lastPathComponent) is not a folder.")
            }

        case .fileDocument:
            guard values.isRegularFile == true else {
                throw AppifyHostError.invalidPackage("\(standardized.lastPathComponent) is not a file.")
            }
        }

        return standardized
    }

    public static func resolvedURL(forPackage packageURL: URL) throws -> URL {
        let standardized = packageURL.standardizedFileURL
        let values: URLResourceValues
        do {
            values = try standardized.resourceValues(forKeys: [.isAliasFileKey, .isSymbolicLinkKey])
        } catch {
            throw AppifyHostError.invalidPackage("\(standardized.lastPathComponent) is not readable.")
        }

        guard values.isSymbolicLink != true else {
            return standardized
        }
        guard values.isAliasFile == true else {
            return standardized
        }

        do {
            return try URL(resolvingAliasFileAt: standardized, options: []).standardizedFileURL
        } catch {
            throw AppifyHostError.invalidPackage("\(standardized.lastPathComponent) alias could not be resolved.")
        }
    }

    public static func workingDirectory(forPackage packageURL: URL, configuration: AppifyHostConfiguration) throws -> URL {
        let documentURL = try documentURL(forPackage: packageURL, configuration: configuration)
        switch configuration.documentMode {
        case .contentPackage:
            return documentURL
        case .folderMarker:
            return documentURL.deletingLastPathComponent()
        case .fileDocument:
            return documentURL.deletingLastPathComponent()
        }
    }
}

public struct TemplateValues: Equatable, Sendable {
    public var bundleURL: URL
    public var documentURL: URL
    public var workingDirectory: URL

    public init(bundleURL: URL, documentURL: URL, workingDirectory: URL) {
        self.bundleURL = bundleURL.standardizedFileURL
        self.documentURL = documentURL.standardizedFileURL
        self.workingDirectory = workingDirectory.standardizedFileURL
    }
}

public enum TemplateExpander {
    public static func expand(_ value: String, values: TemplateValues) -> String {
        value
            .replacingOccurrences(of: "{bundlePath}", with: values.bundleURL.path)
            .replacingOccurrences(of: "{documentPath}", with: values.documentURL.path)
            .replacingOccurrences(of: "{workingDirectory}", with: values.workingDirectory.path)
    }

    public static func expand(_ values: [String: String], templateValues: TemplateValues) -> [String: String] {
        values.mapValues { expand($0, values: templateValues) }
    }
}

public struct ServerCommand: Equatable, Sendable {
    public var executableURL: URL
    public var currentDirectoryURL: URL
    public var arguments: [String]

    public init(executableURL: URL, currentDirectoryURL: URL, arguments: [String]) {
        self.executableURL = executableURL
        self.currentDirectoryURL = currentDirectoryURL
        self.arguments = arguments
    }
}

public enum ServerCommandBuilder {
    public static func command(configuration: AppifyHostConfiguration, templateValues: TemplateValues) throws -> ServerCommand {
        try AppifyHostConfigurationLoader.validatePathToken(configuration.serverExecutable)
        try configuration.serverArguments.forEach(AppifyHostConfigurationLoader.validateArgumentTemplate)

        return ServerCommand(
            executableURL: configuration.serverExecutableURL,
            currentDirectoryURL: configuration.serverDirectoryURL,
            arguments: configuration.serverArguments.map { TemplateExpander.expand($0, values: templateValues) }
        )
    }
}

public enum AppifyHostOpenURL {
    public static let outputPrefix = "APPIFY_HOST_OPEN_URL="

    public static func extract(from line: String) -> URL? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix(outputPrefix) {
            return URL(string: String(trimmed.dropFirst(outputPrefix.count)))
        }

        return nil
    }

    public static func validateReadyURL(_ url: URL, documentURL: URL, bundleURL: URL) throws -> URL {
        guard let scheme = url.scheme?.lowercased() else {
            throw AppifyHostError.invalidOpenURL("URL has no scheme.")
        }

        switch scheme {
        case "http", "https":
            try validateLoopbackHTTPURL(url)
            return url
        case "file":
            return try validateLocalFileURL(url, documentURL: documentURL, bundleURL: bundleURL)
        default:
            throw AppifyHostError.invalidOpenURL("Unsupported URL scheme: \(scheme).")
        }
    }

    public static func isAllowedNavigation(
        _ url: URL,
        readyURL: URL,
        documentURL: URL,
        bundleURL: URL,
        restrictToReadyURLScope: Bool
    ) -> Bool {
        guard url.absoluteString != "about:blank" else {
            return true
        }

        guard let scheme = url.scheme?.lowercased() else {
            return false
        }

        switch scheme {
        case "http", "https":
            guard readyURL.scheme?.lowercased() == scheme,
                  url.host(percentEncoded: false)?.lowercased() == readyURL.host(percentEncoded: false)?.lowercased(),
                  url.port == readyURL.port,
                  url.user == nil,
                  url.password == nil
            else {
                return false
            }
            guard !hasUnsafePath(url) else {
                return false
            }
            guard restrictToReadyURLScope else {
                return true
            }
            return path(url.path(percentEncoded: false), isUnderBasePath: readyURL.path(percentEncoded: false))

        case "file":
            return (try? validateLocalFileURL(url, documentURL: documentURL, bundleURL: bundleURL)) != nil

        default:
            return false
        }
    }

    private static func validateLoopbackHTTPURL(_ url: URL) throws {
        guard let host = url.host(percentEncoded: false)?.lowercased(),
              ["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"].contains(host)
        else {
            throw AppifyHostError.invalidOpenURL("HTTP(S) URLs must point at localhost or loopback.")
        }
        if url.user != nil || url.password != nil {
            throw AppifyHostError.invalidOpenURL("Credentials must not be embedded in the URL.")
        }
        if hasUnsafePath(url) {
            throw AppifyHostError.invalidOpenURL("Dot segments, encoded separators, and backslashes are not allowed in URL paths.")
        }
    }

    private static func validateLocalFileURL(_ url: URL, documentURL: URL, bundleURL: URL) throws -> URL {
        let allowedDirectories = [
            normalizedDirectoryPath(documentURL),
            normalizedDirectoryPath(bundleURL),
        ]
        let filePath = url.standardizedFileURL.path
        guard allowedDirectories.contains(where: { filePath == $0 || filePath.hasPrefix($0 + "/") }) else {
            throw AppifyHostError.invalidOpenURL("file:// URLs must stay inside the document package or app bundle.")
        }
        return url
    }

    private static func path(_ path: String, isUnderBasePath basePath: String) -> Bool {
        let normalizedPath = normalizedURLPath(path)
        let normalizedBasePath = normalizedURLPath(basePath)
        if normalizedBasePath == "/" {
            return normalizedPath.hasPrefix("/")
        }
        return normalizedPath == normalizedBasePath || normalizedPath.hasPrefix(normalizedBasePath + "/")
    }

    private static func normalizedURLPath(_ path: String) -> String {
        var normalized = path.isEmpty ? "/" : path
        if !normalized.hasPrefix("/") {
            normalized = "/" + normalized
        }
        while normalized.count > 1, normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        return normalized
    }

    private static func hasUnsafePath(_ url: URL) -> Bool {
        let encodedPath = url.path(percentEncoded: true).lowercased()
        if encodedPath.contains("%2f") || encodedPath.contains("%5c") {
            return true
        }
        let path = url.path(percentEncoded: false)
        return path.contains("\\") || path.split(separator: "/", omittingEmptySubsequences: true).contains { $0 == "." || $0 == ".." }
    }

    private static func normalizedDirectoryPath(_ url: URL) -> String {
        var path = url.standardizedFileURL.path
        while path.count > 1, path.hasSuffix("/") {
            path.removeLast()
        }
        return path
    }
}

public enum ServerEnvironmentBuilder {
    public static let blockedExactKeys: Set<String> = [
        "BASH_ENV",
        "CDPATH",
        "ENV",
        "GIT_ASKPASS",
        "IFS",
        "SSH_ASKPASS",
        "SUDO_ASKPASS",
        "ZDOTDIR",
    ]
    public static let blockedPrefixes = [
        "DYLD_",
        "LD_",
    ]

    public static func build(base: [String: String], additional: [String: String]) -> [String: String] {
        var environment = sanitized(base)
        for (key, value) in additional {
            environment[key] = value
        }
        return environment
    }

    public static func sanitized(_ environment: [String: String]) -> [String: String] {
        environment.filter { key, _ in
            if blockedExactKeys.contains(key) {
                return false
            }
            return !blockedPrefixes.contains { key.hasPrefix($0) }
        }
    }
}

public struct ProcessTableEntry: Equatable, Sendable {
    public var pid: Int32
    public var parentPID: Int32

    public init(pid: Int32, parentPID: Int32) {
        self.pid = pid
        self.parentPID = parentPID
    }
}

public enum ProcessTree {
    public static func parsePSOutput(_ output: String) -> [ProcessTableEntry] {
        output.split(whereSeparator: \.isNewline).compactMap { line in
            let fields = line.split(whereSeparator: \.isWhitespace)
            guard fields.count >= 2,
                  let pid = Int32(String(fields[0])),
                  let parentPID = Int32(String(fields[1]))
            else {
                return nil
            }
            return ProcessTableEntry(pid: pid, parentPID: parentPID)
        }
    }

    public static func descendantPIDs(rootPID: Int32, entries: [ProcessTableEntry]) -> [Int32] {
        var childrenByParent: [Int32: [Int32]] = [:]
        for entry in entries where entry.pid != rootPID {
            childrenByParent[entry.parentPID, default: []].append(entry.pid)
        }

        var visited = Set<Int32>()
        var result: [Int32] = []

        func collect(_ parentPID: Int32) {
            for childPID in childrenByParent[parentPID, default: []] where !visited.contains(childPID) {
                visited.insert(childPID)
                collect(childPID)
                result.append(childPID)
            }
        }

        collect(rootPID)
        return result
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

private func stringDictionaryValue(_ value: Any?) -> [String: String]? {
    value as? [String: String]
}

private func boolValue(_ value: Any?) -> Bool? {
    if let bool = value as? Bool {
        return bool
    }
    if let number = value as? NSNumber {
        return number.boolValue
    }
    return nil
}

private func positiveTimeIntervalValue(_ value: Any?) -> TimeInterval? {
    if let number = value as? NSNumber {
        let doubleValue = number.doubleValue
        return doubleValue > 0 ? doubleValue : nil
    }
    if let string = value as? String,
       let doubleValue = Double(string),
       doubleValue > 0 {
        return doubleValue
    }
    return nil
}

private func trimmedString(_ value: Any?) -> String? {
    guard let string = stringValue(value)?.trimmingCharacters(in: .whitespacesAndNewlines),
          !string.isEmpty
    else {
        return nil
    }

    return string
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

    var isSafePathCharacter: Bool {
        isASCIIAlphaNumeric || [".", "_", "-", "/"].contains(self)
    }

    var isSafeArgumentTemplateCharacter: Bool {
        isASCIIAlphaNumeric || [".", "_", "-", ":", "@", "/", "%", "+", "=", ",", "{", "}"].contains(self)
    }

    var isSafeEnvironmentKeyCharacter: Bool {
        isASCIIAlphaNumeric || self == "_"
    }
}

public extension AppifyHostConfigurationLoader {
    static func validatePathToken(_ token: String) throws {
        guard !token.isEmpty,
              token != ".",
              token != "..",
              !token.hasPrefix("/"),
              !token.contains(".."),
              token.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              token.allSatisfy(\.isSafePathCharacter)
        else {
            throw AppifyHostError.unsafeConfigurationToken(token)
        }
    }

    static func validateArgumentTemplate(_ token: String) throws {
        guard !token.isEmpty,
              token.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              token.allSatisfy(\.isSafeArgumentTemplateCharacter)
        else {
            throw AppifyHostError.unsafeConfigurationToken(token)
        }
    }

    static func validateEnvironmentKey(_ key: String) throws {
        guard !key.isEmpty,
              key.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              key.allSatisfy(\.isSafeEnvironmentKeyCharacter)
        else {
            throw AppifyHostError.unsafeConfigurationToken(key)
        }
    }

    static func validateEnvironmentTemplate(_ value: String) throws {
        guard value.rangeOfCharacter(from: .newlines) == nil else {
            throw AppifyHostError.unsafeConfigurationToken(value)
        }
    }
}
