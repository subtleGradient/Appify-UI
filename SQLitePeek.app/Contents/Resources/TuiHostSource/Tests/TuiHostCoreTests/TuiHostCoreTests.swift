import XCTest
@testable import TuiHostCore

final class TuiHostCoreTests: XCTestCase {
    func testLoadsLazyGitConfigurationFromInfoPlistFacts() throws {
        let config = try TuiHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(),
            bundleURL: URL(fileURLWithPath: "/Applications/LazyGit.app")
        )

        XCTAssertEqual(config.appName, "LazyGit")
        XCTAssertEqual(config.bundleIdentifier, "com.subtlegradient.LazyGit")
        XCTAssertEqual(config.documentExtensions, ["lazygit"])
        XCTAssertEqual(config.documentMode, .folderMarker)
        XCTAssertEqual(config.commandName, "lazygit")
        XCTAssertEqual(config.commandArguments, ["--path", "{workingDirectory}"])
        XCTAssertEqual(config.supportCommandNames, ["git", "git-lfs"])
        XCTAssertEqual(config.nixPackages, ["ttyd", "lazygit", "git", "git-lfs"])
        XCTAssertEqual(config.logName, "LazyGit")
        XCTAssertEqual(config.windowTitlePrefix, "LazyGit")
        XCTAssertEqual(config.environmentVariables, [
            "LAZYGIT_APP_PACKAGE": "{documentPath}",
            "LAZYGIT_APP_WORKDIR": "{workingDirectory}",
        ])
    }

    func testRejectsUnsafeConfigurationTokens() throws {
        var plist = sampleInfoPlist()
        plist["TuiHost"] = [
            "CommandName": "../lazygit",
            "CommandArguments": [],
        ]

        XCTAssertThrowsError(try TuiHostConfigurationLoader.load(
            infoDictionary: plist,
            bundleURL: URL(fileURLWithPath: "/tmp/LazyGit.app")
        ))
    }

    func testRejectsUnknownDocumentMode() throws {
        var plist = sampleInfoPlist()
        plist["TuiHost"] = [
            "DocumentMode": "mystery",
            "CommandName": "lazygit",
            "CommandArguments": [],
        ]

        XCTAssertThrowsError(try TuiHostConfigurationLoader.load(
            infoDictionary: plist,
            bundleURL: URL(fileURLWithPath: "/tmp/LazyGit.app")
        ))
    }

    func testLoadsSQLitePeekFileDocumentConfiguration() throws {
        let config = try sqlitePeekConfig()

        XCTAssertEqual(config.appName, "SQLite Peek")
        XCTAssertEqual(config.bundleIdentifier, "com.subtlegradient.SQLitePeek")
        XCTAssertEqual(config.documentExtensions, ["db", "sqlite", "sqlite3"])
        XCTAssertEqual(config.documentMode, .fileDocument)
        XCTAssertEqual(config.commandName, "tw")
        XCTAssertEqual(config.commandArguments, ["{documentPath}"])
        XCTAssertEqual(config.supportCommandNames, [])
        XCTAssertEqual(config.nixPackages, ["ttyd", "tabiew"])
    }

    func testSlugGenerationUsesLowercaseASCII() throws {
        let config = try sampleConfig()
        XCTAssertEqual(PackageDocument.slug(for: "My Repo", fallback: "lazygit"), "my-repo")
        XCTAssertEqual(PackageDocument.slug(for: "  My Repo!! ", fallback: "lazygit"), "my-repo")
        XCTAssertEqual(PackageDocument.slug(for: "Repo_123", fallback: "lazygit"), "repo-123")
        XCTAssertEqual(PackageDocument.slug(for: "Æther Repo", fallback: "lazygit"), "ther-repo")
        XCTAssertEqual(PackageDocument.slug(for: "!!!", fallback: "lazygit"), "lazygit")

        let folderURL = URL(fileURLWithPath: "/tmp/My Repo", isDirectory: true)
        let packageURL = PackageDocument.packageURL(forFolder: folderURL, configuration: config)
        XCTAssertEqual(packageURL.path, "/tmp/My Repo/my-repo.lazygit")
    }

    func testPackageURLAndWorkingDirectory() throws {
        let config = try sampleConfig()
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let folderURL = rootURL.appendingPathComponent("My Repo", isDirectory: true)
        try FileManager.default.createDirectory(at: folderURL, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: rootURL)
        }

        let packageURL = PackageDocument.packageURL(forFolder: folderURL, configuration: config)
        try FileManager.default.createDirectory(at: packageURL, withIntermediateDirectories: false)

        XCTAssertEqual(packageURL.lastPathComponent, "my-repo.lazygit")
        XCTAssertEqual(try PackageDocument.workingDirectory(forPackage: packageURL, configuration: config).path, folderURL.path)
        XCTAssertThrowsError(try PackageDocument.workingDirectory(forPackage: URL(fileURLWithPath: "/tmp/nope.txt"), configuration: config))
    }

    func testWorkingDirectoryRequiresLocalRealPackageDirectory() throws {
        let config = try sampleConfig()
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: rootURL)
        }

        let regularFile = rootURL.appendingPathComponent("repo.lazygit")
        FileManager.default.createFile(atPath: regularFile.path, contents: Data())
        XCTAssertThrowsError(try PackageDocument.workingDirectory(forPackage: regularFile, configuration: config))

        let targetDirectory = rootURL.appendingPathComponent("target", isDirectory: true)
        try FileManager.default.createDirectory(at: targetDirectory, withIntermediateDirectories: false)
        let symlink = rootURL.appendingPathComponent("symlink.lazygit")
        try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: targetDirectory)
        XCTAssertThrowsError(try PackageDocument.workingDirectory(forPackage: symlink, configuration: config))

        let remoteURL = URL(string: "https://example.com/repo.lazygit")!
        XCTAssertThrowsError(try PackageDocument.workingDirectory(forPackage: remoteURL, configuration: config))
    }

    func testFileDocumentWorkingDirectoryRequiresLocalRealFile() throws {
        let config = try sqlitePeekConfig()
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: rootURL)
        }

        let databaseFile = rootURL.appendingPathComponent("sample.sqlite")
        FileManager.default.createFile(atPath: databaseFile.path, contents: Data())
        XCTAssertEqual(try PackageDocument.workingDirectory(forPackage: databaseFile, configuration: config).path, rootURL.path)

        let directory = rootURL.appendingPathComponent("not-a-file.sqlite", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        XCTAssertThrowsError(try PackageDocument.workingDirectory(forPackage: directory, configuration: config))

        let targetFile = rootURL.appendingPathComponent("target.sqlite")
        FileManager.default.createFile(atPath: targetFile.path, contents: Data())
        let symlink = rootURL.appendingPathComponent("symlink.sqlite")
        try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: targetFile)
        XCTAssertThrowsError(try PackageDocument.workingDirectory(forPackage: symlink, configuration: config))
    }

    func testToolResolverPrefersNixShell() throws {
        let resolver = TerminalToolResolver(
            environment: ["PATH": "/tools/bin"],
            homeDirectory: URL(fileURLWithPath: "/Users/test"),
            isExecutableFile: { $0 == "/tools/bin/nix-shell" }
        )

        XCTAssertEqual(try resolver.resolve(configuration: sampleConfig()), .nixShell(nixShellURL: URL(fileURLWithPath: "/tools/bin/nix-shell")))
    }

    func testToolResolverFallsBackToDirectTools() throws {
        let executablePaths: Set<String> = [
            "/direct/bin/ttyd",
            "/direct/bin/lazygit",
            "/direct/bin/git",
            "/direct/bin/git-lfs",
        ]
        let resolver = TerminalToolResolver(
            environment: ["PATH": "/direct/bin"],
            homeDirectory: URL(fileURLWithPath: "/Users/test"),
            isExecutableFile: { executablePaths.contains($0) }
        )

        XCTAssertEqual(
            try resolver.resolve(configuration: sampleConfig()),
            .direct(
                ttydURL: URL(fileURLWithPath: "/direct/bin/ttyd"),
                commandURL: URL(fileURLWithPath: "/direct/bin/lazygit"),
                supportCommandURLs: [
                    ResolvedTool(name: "git", url: URL(fileURLWithPath: "/direct/bin/git")),
                    ResolvedTool(name: "git-lfs", url: URL(fileURLWithPath: "/direct/bin/git-lfs")),
                ]
            )
        )
    }

    func testToolResolverReportsMissingDirectRequirements() throws {
        let resolver = TerminalToolResolver(
            environment: ["PATH": "/missing/bin"],
            homeDirectory: URL(fileURLWithPath: "/Users/test"),
            isExecutableFile: { _ in false }
        )

        XCTAssertThrowsError(try resolver.resolve(configuration: sampleConfig())) { error in
            XCTAssertEqual(error as? TuiHostCoreError, .missingRequirements(["ttyd", "lazygit", "git", "git-lfs"]))
            XCTAssertTrue(String(describing: error).contains("Install Nix"))
            XCTAssertTrue(String(describing: error).contains("available on PATH"))
        }
    }

    func testBuildsNixShellCommand() throws {
        let command = TerminalCommandBuilder.command(
            mode: .nixShell(nixShellURL: URL(fileURLWithPath: "/nix/bin/nix-shell")),
            configuration: try sampleConfig(),
            request: TerminalRunnerRequest(
                documentURL: URL(fileURLWithPath: "/tmp/My Repo/my-repo.lazygit"),
                workingDirectory: URL(fileURLWithPath: "/tmp/My Repo"),
                port: 49152,
                basePath: "/tui-secret"
            )
        )

        XCTAssertEqual(command.executableURL.path, "/nix/bin/nix-shell")
        XCTAssertEqual(command.arguments.prefix(6), ["-p", "ttyd", "lazygit", "git", "git-lfs", "--run"])
        XCTAssertEqual(
            command.arguments.last,
            "exec ttyd --interface 127.0.0.1 --port 49152 --writable --check-origin --once --max-clients 1 --base-path /tui-secret --cwd '/tmp/My Repo' lazygit --path '/tmp/My Repo'"
        )
        XCTAssertEqual(
            command.redactedArguments.last,
            "exec ttyd --interface 127.0.0.1 --port 49152 --writable --check-origin --once --max-clients 1 --base-path '/<redacted>' --cwd '/tmp/My Repo' lazygit --path '/tmp/My Repo'"
        )
    }

    func testBuildsDirectCommand() throws {
        let command = TerminalCommandBuilder.command(
            mode: .direct(
                ttydURL: URL(fileURLWithPath: "/tools/ttyd"),
                commandURL: URL(fileURLWithPath: "/tools/lazygit"),
                supportCommandURLs: [
                    ResolvedTool(name: "git", url: URL(fileURLWithPath: "/usr/bin/git")),
                    ResolvedTool(name: "git-lfs", url: URL(fileURLWithPath: "/lfs/bin/git-lfs")),
                ]
            ),
            configuration: try sampleConfig(),
            request: TerminalRunnerRequest(
                documentURL: URL(fileURLWithPath: "/tmp/My Repo/my-repo.lazygit"),
                workingDirectory: URL(fileURLWithPath: "/tmp/My Repo"),
                port: 49152,
                basePath: "/tui-secret"
            )
        )

        XCTAssertEqual(command.executableURL.path, "/tools/ttyd")
        XCTAssertEqual(command.arguments, [
            "--interface", "127.0.0.1",
            "--port", "49152",
            "--writable",
            "--check-origin",
            "--once",
            "--max-clients", "1",
            "--base-path", "/tui-secret",
            "--cwd", "/tmp/My Repo",
            "/tools/lazygit",
            "--path", "/tmp/My Repo",
        ])
        XCTAssertEqual(Array(command.redactedArguments[9...10]), ["--base-path", "/<redacted>"])
        XCTAssertEqual(command.pathPrefixes, ["/usr/bin", "/lfs/bin", "/tools"])
    }

    func testBuildsSQLitePeekNixShellCommand() throws {
        let command = TerminalCommandBuilder.command(
            mode: .nixShell(nixShellURL: URL(fileURLWithPath: "/nix/bin/nix-shell")),
            configuration: try sqlitePeekConfig(),
            request: TerminalRunnerRequest(
                documentURL: URL(fileURLWithPath: "/tmp/Data/sample.sqlite"),
                workingDirectory: URL(fileURLWithPath: "/tmp/Data"),
                port: 49152,
                basePath: "/tui-secret"
            )
        )

        XCTAssertEqual(command.arguments.prefix(5), ["-p", "ttyd", "tabiew", "--run", "exec ttyd --interface 127.0.0.1 --port 49152 --writable --check-origin --once --max-clients 1 --base-path /tui-secret --cwd /tmp/Data tw /tmp/Data/sample.sqlite"])
    }

    func testBuildsSQLitePeekDirectCommand() throws {
        let command = TerminalCommandBuilder.command(
            mode: .direct(
                ttydURL: URL(fileURLWithPath: "/tools/ttyd"),
                commandURL: URL(fileURLWithPath: "/tools/tw"),
                supportCommandURLs: []
            ),
            configuration: try sqlitePeekConfig(),
            request: TerminalRunnerRequest(
                documentURL: URL(fileURLWithPath: "/tmp/Data/sample.sqlite"),
                workingDirectory: URL(fileURLWithPath: "/tmp/Data"),
                port: 49152,
                basePath: "/tui-secret"
            )
        )

        XCTAssertEqual(command.arguments, [
            "--interface", "127.0.0.1",
            "--port", "49152",
            "--writable",
            "--check-origin",
            "--once",
            "--max-clients", "1",
            "--base-path", "/tui-secret",
            "--cwd", "/tmp/Data",
            "/tools/tw",
            "/tmp/Data/sample.sqlite",
        ])
        XCTAssertEqual(command.pathPrefixes, ["/tools"])
    }

    func testDirectCommandPutsSupportToolDirectoriesBeforeTheTuiCommandDirectory() throws {
        let command = TerminalCommandBuilder.command(
            mode: .direct(
                ttydURL: URL(fileURLWithPath: "/attacker/bin/ttyd"),
                commandURL: URL(fileURLWithPath: "/attacker/bin/lazygit"),
                supportCommandURLs: [
                    ResolvedTool(name: "git", url: URL(fileURLWithPath: "/usr/bin/git")),
                    ResolvedTool(name: "git-lfs", url: URL(fileURLWithPath: "/opt/git-lfs/bin/git-lfs")),
                ]
            ),
            configuration: try sampleConfig(),
            request: TerminalRunnerRequest(
                documentURL: URL(fileURLWithPath: "/tmp/repo/repo.lazygit"),
                workingDirectory: URL(fileURLWithPath: "/tmp/repo"),
                port: 49152,
                basePath: "/tui-secret"
            )
        )

        XCTAssertEqual(command.pathPrefixes, ["/usr/bin", "/opt/git-lfs/bin", "/attacker/bin"])
    }

    func testTemplateExpansionBuildsConfiguredEnvironment() throws {
        let config = try sampleConfig()
        let expanded = TemplateExpander.expand(
            config.environmentVariables,
            templateValues: TemplateValues(
                documentURL: URL(fileURLWithPath: "/tmp/repo/repo.lazygit"),
                workingDirectory: URL(fileURLWithPath: "/tmp/repo")
            )
        )

        XCTAssertEqual(expanded["LAZYGIT_APP_PACKAGE"], "/tmp/repo/repo.lazygit")
        XCTAssertEqual(expanded["LAZYGIT_APP_WORKDIR"], "/tmp/repo")
    }

    func testRunnerEnvironmentSanitizesShellAndLoaderHooks() {
        let environment = RunnerEnvironmentBuilder.build(
            base: [
                "PATH": "/usr/local/bin",
                "HOME": "/Users/test",
                "BASH_ENV": "/tmp/payload",
                "ENV": "/tmp/env",
                "DYLD_INSERT_LIBRARIES": "/tmp/lib.dylib",
                "GIT_CONFIG_GLOBAL": "/tmp/gitconfig",
                "GIT_CONFIG_KEY_0": "core.sshCommand",
                "GIT_CONFIG_VALUE_0": "sh /tmp/payload",
                "GIT_EXEC_PATH": "/tmp/git-core",
                "GIT_EXTERNAL_DIFF": "/tmp/diff",
                "GIT_SSH_COMMAND": "sh /tmp/payload",
                "LD_PRELOAD": "/tmp/lib.so",
                "LAZYGIT_CONFIG_FILE": "/tmp/lazygit.yml",
                "SSH_ASKPASS": "/tmp/askpass",
            ],
            pathPrefixes: ["/tools/bin"],
            additional: ["LAZYGIT_APP_PACKAGE": "/tmp/repo/repo.lazygit"]
        )

        XCTAssertEqual(environment["PATH"], "/tools/bin:/usr/local/bin")
        XCTAssertEqual(environment["HOME"], "/Users/test")
        XCTAssertEqual(environment["LAZYGIT_APP_PACKAGE"], "/tmp/repo/repo.lazygit")
        XCTAssertNil(environment["BASH_ENV"])
        XCTAssertNil(environment["ENV"])
        XCTAssertNil(environment["DYLD_INSERT_LIBRARIES"])
        XCTAssertNil(environment["GIT_CONFIG_GLOBAL"])
        XCTAssertNil(environment["GIT_CONFIG_KEY_0"])
        XCTAssertNil(environment["GIT_CONFIG_VALUE_0"])
        XCTAssertNil(environment["GIT_EXEC_PATH"])
        XCTAssertNil(environment["GIT_EXTERNAL_DIFF"])
        XCTAssertNil(environment["GIT_SSH_COMMAND"])
        XCTAssertNil(environment["LD_PRELOAD"])
        XCTAssertNil(environment["LAZYGIT_CONFIG_FILE"])
        XCTAssertNil(environment["SSH_ASKPASS"])
    }

    func testTerminalURLValidation() throws {
        let terminalURL = TerminalURLValidator.terminalURL(port: 49152, basePath: "/tui-secret")
        XCTAssertEqual(terminalURL.absoluteString, "http://127.0.0.1:49152/tui-secret/")

        let allowed = URL(string: "http://127.0.0.1:49152/tui-secret/path")!
        XCTAssertEqual(try TerminalURLValidator.validate(allowed, expectedPort: 49152, expectedBasePath: "/tui-secret"), allowed)

        let rejected = [
            URL(string: "https://127.0.0.1:49152/tui-secret/")!,
            URL(string: "http://localhost:49152/tui-secret/")!,
            URL(string: "http://127.0.0.1:49153/tui-secret/")!,
            URL(string: "http://example.com:49152/tui-secret/")!,
            URL(string: "http://user:pass@127.0.0.1:49152/tui-secret/")!,
            URL(string: "http://127.0.0.1:49152/")!,
            URL(string: "http://127.0.0.1:49152/tui-secret-suffix/")!,
            URL(string: "http://127.0.0.1:49152/tui-secret/../")!,
            URL(string: "http://127.0.0.1:49152/tui-secret/%2e%2e/")!,
            URL(string: "http://127.0.0.1:49152/tui-secret%2F..%2F")!,
            URL(string: "http://127.0.0.1:49152/tui-secret/%5cwindows")!,
        ]

        for url in rejected {
            XCTAssertThrowsError(try TerminalURLValidator.validate(url, expectedPort: 49152, expectedBasePath: "/tui-secret"), url.absoluteString)
        }
    }

    func testTerminalReadyLineDetection() {
        XCTAssertTrue(TerminalReadyLineDetector.isReadyLine("[info] Listening on port: 49152", port: 49152))
        XCTAssertTrue(TerminalReadyLineDetector.isReadyLine("ttyd listening at 127.0.0.1:49152", port: 49152))
        XCTAssertFalse(TerminalReadyLineDetector.isReadyLine("Listening on port: 49153", port: 49152))
        XCTAssertFalse(TerminalReadyLineDetector.isReadyLine("starting ttyd", port: 49152))
    }

    func testProcessTreeParsesPSOutputAndReturnsLeafFirstDescendants() {
        let entries = ProcessTree.parsePSOutput("""
             10     1
             20    10
             30    20
             40    10
            nope  bad
        """)

        XCTAssertEqual(entries, [
            ProcessTableEntry(pid: 10, parentPID: 1),
            ProcessTableEntry(pid: 20, parentPID: 10),
            ProcessTableEntry(pid: 30, parentPID: 20),
            ProcessTableEntry(pid: 40, parentPID: 10),
        ])
        XCTAssertEqual(ProcessTree.descendantPIDs(rootPID: 10, entries: entries), [30, 20, 40])
    }

    private func sampleConfig() throws -> TuiHostConfiguration {
        try TuiHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(),
            bundleURL: URL(fileURLWithPath: "/Applications/LazyGit.app")
        )
    }

    private func sqlitePeekConfig() throws -> TuiHostConfiguration {
        try TuiHostConfigurationLoader.load(
            infoDictionary: sqlitePeekInfoPlist(),
            bundleURL: URL(fileURLWithPath: "/Applications/SQLite Peek.app")
        )
    }

    private func sampleInfoPlist() -> [String: Any] {
        [
            "CFBundleDisplayName": "LazyGit",
            "CFBundleIdentifier": "com.subtlegradient.LazyGit",
            "CFBundleDocumentTypes": [
                [
                    "CFBundleTypeName": "LazyGit Folder",
                    "LSItemContentTypes": ["com.subtlegradient.lazygit"],
                    "LSTypeIsPackage": true,
                ],
            ],
            "UTExportedTypeDeclarations": [
                [
                    "UTTypeIdentifier": "com.subtlegradient.lazygit",
                    "UTTypeTagSpecification": [
                        "public.filename-extension": ["lazygit"],
                    ],
                ],
            ],
            "TuiHost": [
                "CommandName": "lazygit",
                "CommandArguments": ["--path", "{workingDirectory}"],
                "SupportCommandNames": ["git", "git-lfs"],
                "NixPackages": ["ttyd", "lazygit", "git", "git-lfs"],
                "LogName": "LazyGit",
                "WindowTitlePrefix": "LazyGit",
                "EnvironmentVariables": [
                    "LAZYGIT_APP_PACKAGE": "{documentPath}",
                    "LAZYGIT_APP_WORKDIR": "{workingDirectory}",
                ],
            ],
        ]
    }

    private func sqlitePeekInfoPlist() -> [String: Any] {
        [
            "CFBundleDisplayName": "SQLite Peek",
            "CFBundleIdentifier": "com.subtlegradient.SQLitePeek",
            "CFBundleDocumentTypes": [
                [
                    "CFBundleTypeName": "SQLite Database",
                    "LSItemContentTypes": ["com.subtlegradient.sqlite-peek.database"],
                ],
            ],
            "UTImportedTypeDeclarations": [
                [
                    "UTTypeIdentifier": "com.subtlegradient.sqlite-peek.database",
                    "UTTypeTagSpecification": [
                        "public.filename-extension": ["db", "sqlite", "sqlite3"],
                    ],
                ],
            ],
            "TuiHost": [
                "DocumentMode": "fileDocument",
                "CommandName": "tw",
                "CommandArguments": ["{documentPath}"],
                "SupportCommandNames": [],
                "NixPackages": ["ttyd", "tabiew"],
                "LogName": "SQLitePeek",
                "WindowTitlePrefix": "SQLite Peek",
            ],
        ]
    }
}
