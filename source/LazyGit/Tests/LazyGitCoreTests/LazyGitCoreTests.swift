import XCTest
@testable import LazyGitCore

final class LazyGitCoreTests: XCTestCase {
    func testSlugGenerationUsesLowercaseASCII() {
        XCTAssertEqual(LazyGitPackage.slug(for: "My Repo"), "my-repo")
        XCTAssertEqual(LazyGitPackage.slug(for: "  My Repo!! "), "my-repo")
        XCTAssertEqual(LazyGitPackage.slug(for: "Repo_123"), "repo-123")
        XCTAssertEqual(LazyGitPackage.slug(for: "Æther Repo"), "ther-repo")
        XCTAssertEqual(LazyGitPackage.slug(for: "!!!"), "lazygit")
    }

    func testPackageURLAndWorkingDirectory() throws {
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let folderURL = rootURL.appendingPathComponent("My Repo", isDirectory: true)
        try FileManager.default.createDirectory(at: folderURL, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: rootURL)
        }

        let packageURL = LazyGitPackage.packageURL(forFolder: folderURL)
        try FileManager.default.createDirectory(at: packageURL, withIntermediateDirectories: false)

        XCTAssertEqual(packageURL.lastPathComponent, "my-repo.lazygit")
        XCTAssertEqual(try LazyGitPackage.workingDirectory(forPackage: packageURL).path, folderURL.path)
        XCTAssertThrowsError(try LazyGitPackage.workingDirectory(forPackage: URL(fileURLWithPath: "/tmp/nope.txt")))
    }

    func testWorkingDirectoryRequiresLocalRealPackageDirectory() throws {
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: rootURL)
        }

        let regularFile = rootURL.appendingPathComponent("repo.lazygit")
        FileManager.default.createFile(atPath: regularFile.path, contents: Data())
        XCTAssertThrowsError(try LazyGitPackage.workingDirectory(forPackage: regularFile))

        let targetDirectory = rootURL.appendingPathComponent("target", isDirectory: true)
        try FileManager.default.createDirectory(at: targetDirectory, withIntermediateDirectories: false)
        let symlink = rootURL.appendingPathComponent("symlink.lazygit")
        try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: targetDirectory)
        XCTAssertThrowsError(try LazyGitPackage.workingDirectory(forPackage: symlink))

        let remoteURL = URL(string: "https://example.com/repo.lazygit")!
        XCTAssertThrowsError(try LazyGitPackage.workingDirectory(forPackage: remoteURL))
    }

    func testToolResolverPrefersNixShell() throws {
        let resolver = TerminalToolResolver(
            environment: ["PATH": "/tools/bin"],
            homeDirectory: URL(fileURLWithPath: "/Users/test"),
            isExecutableFile: { $0 == "/tools/bin/nix-shell" }
        )

        XCTAssertEqual(try resolver.resolve(), .nixShell(nixShellURL: URL(fileURLWithPath: "/tools/bin/nix-shell")))
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
            try resolver.resolve(),
            .direct(
                ttydURL: URL(fileURLWithPath: "/direct/bin/ttyd"),
                lazygitURL: URL(fileURLWithPath: "/direct/bin/lazygit"),
                gitURL: URL(fileURLWithPath: "/direct/bin/git"),
                gitLFSURL: URL(fileURLWithPath: "/direct/bin/git-lfs")
            )
        )
    }

    func testToolResolverReportsMissingDirectRequirements() {
        let resolver = TerminalToolResolver(
            environment: ["PATH": "/missing/bin"],
            homeDirectory: URL(fileURLWithPath: "/Users/test"),
            isExecutableFile: { _ in false }
        )

        XCTAssertThrowsError(try resolver.resolve()) { error in
            XCTAssertEqual(error as? LazyGitCoreError, .missingRequirements(["ttyd", "lazygit", "git", "git-lfs"]))
            XCTAssertTrue(String(describing: error).contains("Install Nix"))
        }
    }

    func testBuildsNixShellCommand() {
        let command = TerminalCommandBuilder.command(
            mode: .nixShell(nixShellURL: URL(fileURLWithPath: "/nix/bin/nix-shell")),
            request: TerminalRunnerRequest(
                workingDirectory: URL(fileURLWithPath: "/tmp/My Repo"),
                port: 49152,
                basePath: "/lazygit-secret"
            )
        )

        XCTAssertEqual(command.executableURL.path, "/nix/bin/nix-shell")
        XCTAssertEqual(command.arguments.prefix(6), ["-p", "ttyd", "lazygit", "git", "git-lfs", "--run"])
        XCTAssertEqual(
            command.arguments.last,
            "exec ttyd --interface 127.0.0.1 --port 49152 --writable --check-origin --once --max-clients 1 --base-path /lazygit-secret --cwd '/tmp/My Repo' lazygit --path '/tmp/My Repo'"
        )
        XCTAssertEqual(
            command.redactedArguments.last,
            "exec ttyd --interface 127.0.0.1 --port 49152 --writable --check-origin --once --max-clients 1 --base-path '/<redacted>' --cwd '/tmp/My Repo' lazygit --path '/tmp/My Repo'"
        )
    }

    func testBuildsDirectCommand() {
        let command = TerminalCommandBuilder.command(
            mode: .direct(
                ttydURL: URL(fileURLWithPath: "/tools/ttyd"),
                lazygitURL: URL(fileURLWithPath: "/tools/lazygit"),
                gitURL: URL(fileURLWithPath: "/usr/bin/git"),
                gitLFSURL: URL(fileURLWithPath: "/lfs/bin/git-lfs")
            ),
            request: TerminalRunnerRequest(
                workingDirectory: URL(fileURLWithPath: "/tmp/My Repo"),
                port: 49152,
                basePath: "/lazygit-secret"
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
            "--base-path", "/lazygit-secret",
            "--cwd", "/tmp/My Repo",
            "/tools/lazygit",
            "--path", "/tmp/My Repo",
        ])
        XCTAssertEqual(Array(command.redactedArguments[9...10]), ["--base-path", "/<redacted>"])
        XCTAssertEqual(command.pathPrefixes, ["/usr/bin", "/lfs/bin", "/tools"])
    }

    func testDirectCommandPutsResolvedGitBeforeOtherToolDirectories() {
        let command = TerminalCommandBuilder.command(
            mode: .direct(
                ttydURL: URL(fileURLWithPath: "/attacker/bin/ttyd"),
                lazygitURL: URL(fileURLWithPath: "/attacker/bin/lazygit"),
                gitURL: URL(fileURLWithPath: "/usr/bin/git"),
                gitLFSURL: URL(fileURLWithPath: "/opt/git-lfs/bin/git-lfs")
            ),
            request: TerminalRunnerRequest(
                workingDirectory: URL(fileURLWithPath: "/tmp/repo"),
                port: 49152,
                basePath: "/lazygit-secret"
            )
        )

        XCTAssertEqual(command.pathPrefixes, ["/usr/bin", "/opt/git-lfs/bin", "/attacker/bin"])
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
        let terminalURL = TerminalURLValidator.terminalURL(port: 49152, basePath: "/lazygit-secret")
        XCTAssertEqual(terminalURL.absoluteString, "http://127.0.0.1:49152/lazygit-secret/")

        let allowed = URL(string: "http://127.0.0.1:49152/lazygit-secret/path")!
        XCTAssertEqual(try TerminalURLValidator.validate(allowed, expectedPort: 49152, expectedBasePath: "/lazygit-secret"), allowed)

        let rejected = [
            URL(string: "https://127.0.0.1:49152/lazygit-secret/")!,
            URL(string: "http://localhost:49152/lazygit-secret/")!,
            URL(string: "http://127.0.0.1:49153/lazygit-secret/")!,
            URL(string: "http://example.com:49152/lazygit-secret/")!,
            URL(string: "http://user:pass@127.0.0.1:49152/lazygit-secret/")!,
            URL(string: "http://127.0.0.1:49152/")!,
            URL(string: "http://127.0.0.1:49152/lazygit-secret-suffix/")!,
            URL(string: "http://127.0.0.1:49152/lazygit-secret/../")!,
            URL(string: "http://127.0.0.1:49152/lazygit-secret/%2e%2e/")!,
            URL(string: "http://127.0.0.1:49152/lazygit-secret%2F..%2F")!,
            URL(string: "http://127.0.0.1:49152/lazygit-secret/%5cwindows")!,
        ]

        for url in rejected {
            XCTAssertThrowsError(try TerminalURLValidator.validate(url, expectedPort: 49152, expectedBasePath: "/lazygit-secret"), url.absoluteString)
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
}
