import Foundation

public struct TuiHostConfiguration: Equatable, Sendable {
    public var appName: String
    public var bundleIdentifier: String
    public var bundleURL: URL
    public var documentExtensions: [String]
    public var commandName: String
    public var commandArguments: [String]
    public var supportCommandNames: [String]
    public var nixPackages: [String]
    public var logName: String
    public var windowTitlePrefix: String
    public var environmentVariables: [String: String]

    public init(
        appName: String,
        bundleIdentifier: String,
        bundleURL: URL,
        documentExtensions: [String],
        commandName: String,
        commandArguments: [String],
        supportCommandNames: [String],
        nixPackages: [String],
        logName: String,
        windowTitlePrefix: String,
        environmentVariables: [String: String]
    ) {
        self.appName = appName
        self.bundleIdentifier = bundleIdentifier
        self.bundleURL = bundleURL
        self.documentExtensions = documentExtensions
        self.commandName = commandName
        self.commandArguments = commandArguments
        self.supportCommandNames = supportCommandNames
        self.nixPackages = nixPackages
        self.logName = logName
        self.windowTitlePrefix = windowTitlePrefix
        self.environmentVariables = environmentVariables
    }

    public var primaryDocumentExtension: String {
        documentExtensions.first ?? "tui"
    }
}

public enum TuiHostCoreError: Error, Equatable, CustomStringConvertible, Sendable {
    case missingInfoPlist(String)
    case invalidInfoPlist(String)
    case invalidPackage(String)
    case missingRequirements([String])
    case unsafeConfigurationToken(String)
    case invalidTerminalURL(String)

    public var description: String {
        switch self {
        case .missingInfoPlist(let message):
            "Missing Info.plist: \(message)"
        case .invalidInfoPlist(let message):
            "Invalid Info.plist: \(message)"
        case .invalidPackage(let message):
            "Invalid package: \(message)"
        case .missingRequirements(let missing):
            "Could not find nix-shell. Also missing direct runtime requirement(s): \(missing.joined(separator: ", ")). Install Nix, or install \(missing.joined(separator: ", ")) directly."
        case .unsafeConfigurationToken(let token):
            "TuiHost configuration token is not allowed: \(token)"
        case .invalidTerminalURL(let message):
            "Terminal navigation was rejected: \(message)"
        }
    }
}

public enum TuiHostConfigurationLoader {
    public static func load(bundleURL: URL, environment: [String: String] = ProcessInfo.processInfo.environment) throws -> TuiHostConfiguration {
        let infoURL = bundleURL.appendingPathComponent("Contents/Info.plist", isDirectory: false)
        guard let info = NSDictionary(contentsOf: infoURL) as? [String: Any] else {
            throw TuiHostCoreError.missingInfoPlist("Could not read \(infoURL.path).")
        }

        return try load(infoDictionary: info, bundleURL: bundleURL, environment: environment)
    }

    public static func load(
        infoDictionary: [String: Any],
        bundleURL: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> TuiHostConfiguration {
        let appName = stringValue(infoDictionary["CFBundleDisplayName"])
            ?? stringValue(infoDictionary["CFBundleName"])
            ?? bundleURL.deletingPathExtension().lastPathComponent
        let bundleIdentifier = stringValue(infoDictionary["CFBundleIdentifier"])
            ?? "local.tui-host.\(appName.replacingOccurrences(of: " ", with: "-"))"

        guard let hostSettings = infoDictionary["TuiHost"] as? [String: Any] else {
            throw TuiHostCoreError.invalidInfoPlist("TuiHost dictionary is required.")
        }

        guard let commandName = stringValue(hostSettings["CommandName"]), !commandName.isEmpty else {
            throw TuiHostCoreError.invalidInfoPlist("TuiHost:CommandName is required.")
        }

        let commandArguments = stringArrayValue(hostSettings["CommandArguments"]) ?? []
        let supportCommandNames = stringArrayValue(hostSettings["SupportCommandNames"]) ?? []
        let nixPackages = stringArrayValue(hostSettings["NixPackages"])
            ?? unique(["ttyd", commandName] + supportCommandNames)
        let logName = stringValue(hostSettings["LogName"]) ?? appName
        let windowTitlePrefix = stringValue(hostSettings["WindowTitlePrefix"]) ?? appName
        let environmentVariables = stringDictionaryValue(hostSettings["EnvironmentVariables"]) ?? [:]
        let documentExtensions = parseDocumentExtensions(from: infoDictionary)

        guard !documentExtensions.isEmpty else {
            throw TuiHostCoreError.invalidInfoPlist("At least one document filename extension is required.")
        }

        try validateToolName(commandName)
        try supportCommandNames.forEach(validateToolName)
        try nixPackages.forEach(validateToolName)
        try commandArguments.forEach(validateArgumentTemplate)
        try environmentVariables.keys.forEach(validateEnvironmentKey)
        try environmentVariables.values.forEach(validateEnvironmentTemplate)

        return TuiHostConfiguration(
            appName: appName,
            bundleIdentifier: bundleIdentifier,
            bundleURL: bundleURL.standardizedFileURL,
            documentExtensions: documentExtensions,
            commandName: commandName,
            commandArguments: commandArguments,
            supportCommandNames: supportCommandNames,
            nixPackages: nixPackages,
            logName: logName,
            windowTitlePrefix: windowTitlePrefix,
            environmentVariables: environmentVariables
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

    public static func packageURL(forFolder folderURL: URL, configuration: TuiHostConfiguration) -> URL {
        let standardized = folderURL.standardizedFileURL
        let fallback = slug(for: configuration.appName, fallback: "tui")
        let baseName = slug(for: standardized.lastPathComponent, fallback: fallback)
        return standardized.appendingPathComponent("\(baseName).\(configuration.primaryDocumentExtension)", isDirectory: true)
    }

    public static func workingDirectory(forPackage packageURL: URL, configuration: TuiHostConfiguration) throws -> URL {
        let standardized = packageURL.standardizedFileURL
        guard standardized.isFileURL else {
            throw TuiHostCoreError.invalidPackage("Expected a local package.")
        }
        guard configuration.documentExtensions.contains(standardized.pathExtension.lowercased()) else {
            let expected = configuration.documentExtensions.map { ".\($0)" }.joined(separator: ", ")
            throw TuiHostCoreError.invalidPackage("Expected one of: \(expected).")
        }
        let values: URLResourceValues
        do {
            values = try standardized.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        } catch {
            throw TuiHostCoreError.invalidPackage("\(standardized.lastPathComponent) is not a readable package folder.")
        }
        guard values.isSymbolicLink != true else {
            throw TuiHostCoreError.invalidPackage("\(standardized.lastPathComponent) must be a real folder, not a symlink.")
        }
        guard values.isDirectory == true else {
            throw TuiHostCoreError.invalidPackage("\(standardized.lastPathComponent) is not a folder.")
        }

        return standardized.deletingLastPathComponent()
    }
}

public struct ResolvedTool: Equatable, Sendable {
    public var name: String
    public var url: URL

    public init(name: String, url: URL) {
        self.name = name
        self.url = url
    }
}

public enum RunnerMode: Equatable, Sendable {
    case nixShell(nixShellURL: URL)
    case direct(ttydURL: URL, commandURL: URL, supportCommandURLs: [ResolvedTool])
}

public struct RunnerCommand: Equatable, Sendable {
    public var executableURL: URL
    public var arguments: [String]
    public var redactedArguments: [String]
    public var pathPrefixes: [String]
    public var mode: RunnerMode

    public init(
        executableURL: URL,
        arguments: [String],
        redactedArguments: [String],
        pathPrefixes: [String],
        mode: RunnerMode
    ) {
        self.executableURL = executableURL
        self.arguments = arguments
        self.redactedArguments = redactedArguments
        self.pathPrefixes = pathPrefixes
        self.mode = mode
    }
}

public struct TerminalRunnerRequest: Equatable, Sendable {
    public var documentURL: URL
    public var workingDirectory: URL
    public var port: Int
    public var basePath: String

    public init(documentURL: URL, workingDirectory: URL, port: Int, basePath: String) {
        self.documentURL = documentURL.standardizedFileURL
        self.workingDirectory = workingDirectory.standardizedFileURL
        self.port = port
        self.basePath = basePath
    }
}

public struct TerminalToolResolver: Sendable {
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

    public func resolve(configuration: TuiHostConfiguration) throws -> RunnerMode {
        if let nixShell = findExecutable(named: "nix-shell") {
            return .nixShell(nixShellURL: URL(fileURLWithPath: nixShell))
        }

        let ttyd = findExecutable(named: "ttyd")
        let command = findExecutable(named: configuration.commandName)

        var missing: [String] = []
        if ttyd == nil { missing.append("ttyd") }
        if command == nil { missing.append(configuration.commandName) }
        var supportTools: [ResolvedTool] = []
        for name in configuration.supportCommandNames {
            if let path = findExecutable(named: name) {
                supportTools.append(ResolvedTool(name: name, url: URL(fileURLWithPath: path)))
            } else {
                missing.append(name)
            }
        }

        guard let ttyd, let command, missing.isEmpty else {
            throw TuiHostCoreError.missingRequirements(missing)
        }

        return .direct(
            ttydURL: URL(fileURLWithPath: ttyd),
            commandURL: URL(fileURLWithPath: command),
            supportCommandURLs: supportTools
        )
    }

    public func findExecutable(named name: String) -> String? {
        candidates(for: name).first(where: isExecutableFile)
    }

    private func candidates(for name: String) -> [String] {
        let commonDirectories: [String]
        switch name {
        case "nix-shell":
            commonDirectories = [
                "/nix/var/nix/profiles/default/bin",
                "/run/current-system/sw/bin",
                homeDirectory.appendingPathComponent(".nix-profile/bin").path,
                "/opt/homebrew/bin",
                "/usr/local/bin",
            ]
        case "git":
            commonDirectories = [
                "/usr/bin",
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/nix/var/nix/profiles/default/bin",
                "/run/current-system/sw/bin",
                homeDirectory.appendingPathComponent(".nix-profile/bin").path,
            ]
        default:
            commonDirectories = [
                homeDirectory.appendingPathComponent(".nix-profile/bin").path,
                "/nix/var/nix/profiles/default/bin",
                "/run/current-system/sw/bin",
                "/opt/homebrew/bin",
                "/usr/local/bin",
            ]
        }

        let pathDirectories = environment["PATH", default: ""]
            .split(separator: ":", omittingEmptySubsequences: true)
            .map(String.init)

        return unique(commonDirectories + pathDirectories)
            .map { URL(fileURLWithPath: $0).appendingPathComponent(name).path }
    }
}

public enum TerminalCommandBuilder {
    public static func command(
        mode: RunnerMode,
        configuration: TuiHostConfiguration,
        request: TerminalRunnerRequest
    ) -> RunnerCommand {
        let values = TemplateValues(documentURL: request.documentURL, workingDirectory: request.workingDirectory)
        let commandArguments = configuration.commandArguments.map { TemplateExpander.expand($0, values: values) }

        switch mode {
        case .nixShell(let nixShellURL):
            let ttydArgs = ttydArguments(
                workingDirectory: request.workingDirectory,
                port: request.port,
                basePath: request.basePath,
                command: configuration.commandName,
                commandArguments: commandArguments
            )
            let redactedTTYDArguments = ttydArguments(
                workingDirectory: request.workingDirectory,
                port: request.port,
                basePath: "/<redacted>",
                command: configuration.commandName,
                commandArguments: commandArguments
            )
            let runCommand = "exec " + Shell.join(["ttyd"] + ttydArgs)
            let redactedRunCommand = "exec " + Shell.join(["ttyd"] + redactedTTYDArguments)
            return RunnerCommand(
                executableURL: nixShellURL,
                arguments: ["-p"] + configuration.nixPackages + ["--run", runCommand],
                redactedArguments: ["-p"] + configuration.nixPackages + ["--run", redactedRunCommand],
                pathPrefixes: [nixShellURL.deletingLastPathComponent().path],
                mode: mode
            )

        case .direct(let ttydURL, let commandURL, let supportCommandURLs):
            return RunnerCommand(
                executableURL: ttydURL,
                arguments: ttydArguments(
                    workingDirectory: request.workingDirectory,
                    port: request.port,
                    basePath: request.basePath,
                    command: commandURL.path,
                    commandArguments: commandArguments
                ),
                redactedArguments: ttydArguments(
                    workingDirectory: request.workingDirectory,
                    port: request.port,
                    basePath: "/<redacted>",
                    command: commandURL.path,
                    commandArguments: commandArguments
                ),
                pathPrefixes: unique(
                    supportCommandURLs.map { $0.url.deletingLastPathComponent().path }
                        + [
                            commandURL.deletingLastPathComponent().path,
                            ttydURL.deletingLastPathComponent().path,
                        ]
                ),
                mode: mode
            )
        }
    }

    private static func ttydArguments(
        workingDirectory: URL,
        port: Int,
        basePath: String,
        command: String,
        commandArguments: [String]
    ) -> [String] {
        [
            "--interface", "127.0.0.1",
            "--port", String(port),
            "--writable",
            "--check-origin",
            "--once",
            "--max-clients", "1",
            "--base-path", basePath,
            "--cwd", workingDirectory.path,
            command,
        ] + commandArguments
    }
}

public struct TemplateValues: Equatable, Sendable {
    public var documentURL: URL
    public var workingDirectory: URL

    public init(documentURL: URL, workingDirectory: URL) {
        self.documentURL = documentURL.standardizedFileURL
        self.workingDirectory = workingDirectory.standardizedFileURL
    }
}

public enum TemplateExpander {
    public static func expand(_ value: String, values: TemplateValues) -> String {
        value
            .replacingOccurrences(of: "{documentPath}", with: values.documentURL.path)
            .replacingOccurrences(of: "{workingDirectory}", with: values.workingDirectory.path)
    }

    public static func expand(_ values: [String: String], templateValues: TemplateValues) -> [String: String] {
        values.mapValues { expand($0, values: templateValues) }
    }
}

public enum TerminalURLValidator {
    public static func terminalURL(port: Int, basePath: String) -> URL {
        let normalized = normalizedBasePath(basePath)
        return URL(string: "http://127.0.0.1:\(port)\(normalized)/")!
    }

    public static func validate(_ url: URL, expectedPort: Int, expectedBasePath: String) throws -> URL {
        guard url.scheme?.lowercased() == "http" else {
            throw TuiHostCoreError.invalidTerminalURL("Only the generated http://127.0.0.1 terminal origin is allowed.")
        }
        guard url.host(percentEncoded: false) == "127.0.0.1" else {
            throw TuiHostCoreError.invalidTerminalURL("Host must be 127.0.0.1.")
        }
        guard url.port == expectedPort else {
            throw TuiHostCoreError.invalidTerminalURL("Port must be \(expectedPort).")
        }
        if url.user != nil || url.password != nil {
            throw TuiHostCoreError.invalidTerminalURL("Credentials must not be embedded in the URL.")
        }
        let basePath = normalizedBasePath(expectedBasePath)
        let encodedPath = url.path(percentEncoded: true).lowercased()
        if encodedPath.contains("%2f") || encodedPath.contains("%5c") {
            throw TuiHostCoreError.invalidTerminalURL("Encoded path separators are not allowed.")
        }
        let path = url.path(percentEncoded: false)
        if path.contains("\\") || pathComponents(path).contains(where: { $0 == "." || $0 == ".." }) {
            throw TuiHostCoreError.invalidTerminalURL("Dot segments and backslashes are not allowed in terminal paths.")
        }
        guard path == basePath || path.hasPrefix(basePath + "/") else {
            throw TuiHostCoreError.invalidTerminalURL("Path must stay under the generated terminal base path.")
        }
        return url
    }

    public static func isAllowed(_ url: URL, expectedPort: Int, expectedBasePath: String) -> Bool {
        (try? validate(url, expectedPort: expectedPort, expectedBasePath: expectedBasePath)) != nil
    }

    private static func normalizedBasePath(_ basePath: String) -> String {
        var normalized = basePath
        if !normalized.hasPrefix("/") {
            normalized = "/" + normalized
        }
        while normalized.count > 1, normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        return normalized
    }

    private static func pathComponents(_ path: String) -> [String] {
        path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    }
}

public enum TerminalReadyLineDetector {
    public static func isReadyLine(_ line: String, port: Int) -> Bool {
        let lowercased = line.lowercased()
        return lowercased.contains("listening") && lowercased.contains(String(port))
    }
}

public enum RunnerEnvironmentBuilder {
    public static let blockedExactKeys: Set<String> = [
        "BASH_ENV",
        "CDPATH",
        "ENV",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_ASKPASS",
        "GIT_CONFIG",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_NOSYSTEM",
        "GIT_CONFIG_PARAMETERS",
        "GIT_DIR",
        "GIT_EDITOR",
        "GIT_EXEC_PATH",
        "GIT_EXTERNAL_DIFF",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_PROXY_COMMAND",
        "GIT_SEQUENCE_EDITOR",
        "GIT_SSH",
        "GIT_SSH_COMMAND",
        "GIT_TEMPLATE_DIR",
        "GIT_WORK_TREE",
        "IFS",
        "LAZYGIT_CONFIG_DIR",
        "LAZYGIT_CONFIG_FILE",
        "SSH_ASKPASS",
        "SHELLOPTS",
        "SUDO_ASKPASS",
        "ZDOTDIR",
    ]
    public static let blockedPrefixes = [
        "DYLD_",
        "GIT_CONFIG_KEY_",
        "GIT_CONFIG_VALUE_",
        "LD_",
    ]

    public static func build(
        base: [String: String],
        pathPrefixes: [String],
        additional: [String: String]
    ) -> [String: String] {
        var environment = sanitized(base)
        for (key, value) in additional {
            environment[key] = value
        }

        let prefix = pathPrefixes.filter { !$0.isEmpty }.joined(separator: ":")
        guard !prefix.isEmpty else {
            return environment
        }

        let currentPath = environment["PATH", default: ""]
        environment["PATH"] = currentPath.isEmpty ? prefix : "\(prefix):\(currentPath)"
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

public enum Shell {
    public static func join(_ arguments: [String]) -> String {
        arguments.map(quote).joined(separator: " ")
    }

    public static func quote(_ value: String) -> String {
        guard !value.isEmpty else {
            return "''"
        }
        let safeCharacters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_+-=.,/:@%")
        if value.unicodeScalars.allSatisfy({ safeCharacters.contains($0) }) {
            return value
        }
        return "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
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

private func arrayOfDictionaries(_ value: Any?) -> [[String: Any]] {
    value as? [[String: Any]] ?? []
}

private func unique(_ values: [String]) -> [String] {
    var seen = Set<String>()
    var result: [String] = []
    for value in values where !value.isEmpty && !seen.contains(value) {
        seen.insert(value)
        result.append(value)
    }
    return result
}

private func validateToolName(_ token: String) throws {
    guard !token.isEmpty,
          token != ".",
          token != "..",
          !token.contains("/"),
          token.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
          token.allSatisfy(\.isSafeToolCharacter)
    else {
        throw TuiHostCoreError.unsafeConfigurationToken(token)
    }
}

private func validateArgumentTemplate(_ token: String) throws {
    guard !token.isEmpty,
          token.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
          token.allSatisfy(\.isSafeArgumentTemplateCharacter)
    else {
        throw TuiHostCoreError.unsafeConfigurationToken(token)
    }
}

private func validateEnvironmentKey(_ key: String) throws {
    guard !key.isEmpty,
          key.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
          key.allSatisfy(\.isSafeEnvironmentKeyCharacter)
    else {
        throw TuiHostCoreError.unsafeConfigurationToken(key)
    }
}

private func validateEnvironmentTemplate(_ value: String) throws {
    guard value.rangeOfCharacter(from: .newlines) == nil else {
        throw TuiHostCoreError.unsafeConfigurationToken(value)
    }
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

    var isSafeToolCharacter: Bool {
        isASCIIAlphaNumeric || ["_", "-", ".", "+"].contains(self)
    }

    var isSafeArgumentTemplateCharacter: Bool {
        isASCIIAlphaNumeric || [".", "_", "-", ":", "@", "/", "%", "+", "=", ",", "{", "}"].contains(self)
    }

    var isSafeEnvironmentKeyCharacter: Bool {
        isASCIIAlphaNumeric || self == "_"
    }
}
