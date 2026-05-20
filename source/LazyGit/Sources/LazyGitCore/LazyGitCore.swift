import Foundation

public enum LazyGitCoreError: Error, Equatable, CustomStringConvertible, Sendable {
    case invalidPackage(String)
    case missingRequirements([String])
    case invalidTerminalURL(String)

    public var description: String {
        switch self {
        case .invalidPackage(let message):
            "Invalid .lazygit package: \(message)"
        case .missingRequirements(let missing):
            "Could not find nix-shell. Also missing direct runtime requirement(s): \(missing.joined(separator: ", ")). Install Nix, or install ttyd, lazygit, git, and git-lfs directly."
        case .invalidTerminalURL(let message):
            "Terminal navigation was rejected: \(message)"
        }
    }
}

public enum LazyGitPackage {
    public static let pathExtension = "lazygit"

    public static func slug(for folderName: String) -> String {
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
        return trimmed.isEmpty ? "lazygit" : trimmed
    }

    public static func packageURL(forFolder folderURL: URL) -> URL {
        let standardized = folderURL.standardizedFileURL
        let baseName = slug(for: standardized.lastPathComponent)
        return standardized.appendingPathComponent("\(baseName).\(pathExtension)", isDirectory: true)
    }

    public static func workingDirectory(forPackage packageURL: URL) throws -> URL {
        let standardized = packageURL.standardizedFileURL
        guard standardized.pathExtension == pathExtension else {
            throw LazyGitCoreError.invalidPackage("Expected a .\(pathExtension) package.")
        }

        return standardized.deletingLastPathComponent()
    }
}

public enum RunnerMode: Equatable, Sendable {
    case nixShell(nixShellURL: URL)
    case direct(ttydURL: URL, lazygitURL: URL, gitURL: URL, gitLFSURL: URL)
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
    public var workingDirectory: URL
    public var port: Int
    public var basePath: String

    public init(workingDirectory: URL, port: Int, basePath: String) {
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

    public func resolve() throws -> RunnerMode {
        if let nixShell = findExecutable(named: "nix-shell") {
            return .nixShell(nixShellURL: URL(fileURLWithPath: nixShell))
        }

        let ttyd = findExecutable(named: "ttyd")
        let lazygit = findExecutable(named: "lazygit")
        let git = findExecutable(named: "git")
        let gitLFS = findExecutable(named: "git-lfs")

        var missing: [String] = []
        if ttyd == nil { missing.append("ttyd") }
        if lazygit == nil { missing.append("lazygit") }
        if git == nil { missing.append("git") }
        if gitLFS == nil { missing.append("git-lfs") }

        guard let ttyd, let lazygit, let git, let gitLFS else {
            throw LazyGitCoreError.missingRequirements(missing)
        }

        return .direct(
            ttydURL: URL(fileURLWithPath: ttyd),
            lazygitURL: URL(fileURLWithPath: lazygit),
            gitURL: URL(fileURLWithPath: git),
            gitLFSURL: URL(fileURLWithPath: gitLFS)
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
    public static func command(mode: RunnerMode, request: TerminalRunnerRequest) -> RunnerCommand {
        switch mode {
        case .nixShell(let nixShellURL):
            let ttydArgs = ttydArguments(
                workingDirectory: request.workingDirectory,
                port: request.port,
                basePath: request.basePath,
                lazygitCommand: "lazygit"
            )
            let redactedTTYDArguments = ttydArguments(
                workingDirectory: request.workingDirectory,
                port: request.port,
                basePath: "/<redacted>",
                lazygitCommand: "lazygit"
            )
            let runCommand = "exec " + Shell.join(["ttyd"] + ttydArgs)
            let redactedRunCommand = "exec " + Shell.join(["ttyd"] + redactedTTYDArguments)
            return RunnerCommand(
                executableURL: nixShellURL,
                arguments: ["-p", "ttyd", "lazygit", "git", "git-lfs", "--run", runCommand],
                redactedArguments: ["-p", "ttyd", "lazygit", "git", "git-lfs", "--run", redactedRunCommand],
                pathPrefixes: [nixShellURL.deletingLastPathComponent().path],
                mode: mode
            )

        case .direct(let ttydURL, let lazygitURL, let gitURL, let gitLFSURL):
            return RunnerCommand(
                executableURL: ttydURL,
                arguments: ttydArguments(
                    workingDirectory: request.workingDirectory,
                    port: request.port,
                    basePath: request.basePath,
                    lazygitCommand: lazygitURL.path
                ),
                redactedArguments: ttydArguments(
                    workingDirectory: request.workingDirectory,
                    port: request.port,
                    basePath: "/<redacted>",
                    lazygitCommand: lazygitURL.path
                ),
                pathPrefixes: unique([
                    ttydURL.deletingLastPathComponent().path,
                    lazygitURL.deletingLastPathComponent().path,
                    gitURL.deletingLastPathComponent().path,
                    gitLFSURL.deletingLastPathComponent().path,
                ]),
                mode: mode
            )
        }
    }

    private static func ttydArguments(
        workingDirectory: URL,
        port: Int,
        basePath: String,
        lazygitCommand: String
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
            lazygitCommand,
            "--path", workingDirectory.path,
        ]
    }
}

public enum TerminalURLValidator {
    public static func terminalURL(port: Int, basePath: String) -> URL {
        let normalized = normalizedBasePath(basePath)
        return URL(string: "http://127.0.0.1:\(port)\(normalized)/")!
    }

    public static func validate(_ url: URL, expectedPort: Int, expectedBasePath: String) throws -> URL {
        guard url.scheme?.lowercased() == "http" else {
            throw LazyGitCoreError.invalidTerminalURL("Only the generated http://127.0.0.1 terminal origin is allowed.")
        }
        guard url.host(percentEncoded: false) == "127.0.0.1" else {
            throw LazyGitCoreError.invalidTerminalURL("Host must be 127.0.0.1.")
        }
        guard url.port == expectedPort else {
            throw LazyGitCoreError.invalidTerminalURL("Port must be \(expectedPort).")
        }
        if url.user != nil || url.password != nil {
            throw LazyGitCoreError.invalidTerminalURL("Credentials must not be embedded in the URL.")
        }
        let basePath = normalizedBasePath(expectedBasePath)
        let path = url.path
        guard path == basePath || path.hasPrefix(basePath + "/") else {
            throw LazyGitCoreError.invalidTerminalURL("Path must stay under the generated terminal base path.")
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
        "IFS",
        "SHELLOPTS",
        "ZDOTDIR",
    ]
    public static let blockedPrefixes = [
        "DYLD_",
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

private func unique(_ values: [String]) -> [String] {
    var seen = Set<String>()
    var result: [String] = []
    for value in values where !value.isEmpty && !seen.contains(value) {
        seen.insert(value)
        result.append(value)
    }
    return result
}
