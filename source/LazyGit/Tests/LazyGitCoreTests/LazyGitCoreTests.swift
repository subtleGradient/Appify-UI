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
        let folderURL = URL(fileURLWithPath: "/tmp/My Repo")
        let packageURL = LazyGitPackage.packageURL(forFolder: folderURL)

        XCTAssertEqual(packageURL.path, "/tmp/My Repo/my-repo.lazygit")
        XCTAssertEqual(try LazyGitPackage.workingDirectory(forPackage: packageURL).path, "/tmp/My Repo")
        XCTAssertThrowsError(try LazyGitPackage.workingDirectory(forPackage: URL(fileURLWithPath: "/tmp/nope.txt")))
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
                port: 49152
            )
        )

        XCTAssertEqual(command.executableURL.path, "/nix/bin/nix-shell")
        XCTAssertEqual(command.arguments.prefix(6), ["-p", "ttyd", "lazygit", "git", "git-lfs", "--run"])
        XCTAssertEqual(
            command.arguments.last,
            "exec ttyd --interface 127.0.0.1 --port 49152 --writable --check-origin --max-clients 1 --cwd '/tmp/My Repo' lazygit --path '/tmp/My Repo'"
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
                port: 49152
            )
        )

        XCTAssertEqual(command.executableURL.path, "/tools/ttyd")
        XCTAssertEqual(command.arguments, [
            "--interface", "127.0.0.1",
            "--port", "49152",
            "--writable",
            "--check-origin",
            "--max-clients", "1",
            "--cwd", "/tmp/My Repo",
            "/tools/lazygit",
            "--path", "/tmp/My Repo",
        ])
        XCTAssertEqual(command.pathPrefixes, ["/tools", "/usr/bin", "/lfs/bin"])
    }

    func testTerminalURLValidation() throws {
        let allowed = URL(string: "http://127.0.0.1:49152/path")!
        XCTAssertEqual(try TerminalURLValidator.validate(allowed, expectedPort: 49152), allowed)

        let rejected = [
            URL(string: "https://127.0.0.1:49152/")!,
            URL(string: "http://localhost:49152/")!,
            URL(string: "http://127.0.0.1:49153/")!,
            URL(string: "http://example.com:49152/")!,
            URL(string: "http://user:pass@127.0.0.1:49152/")!,
        ]

        for url in rejected {
            XCTAssertThrowsError(try TerminalURLValidator.validate(url, expectedPort: 49152), url.absoluteString)
        }
    }

    func testTerminalReadyLineDetection() {
        XCTAssertTrue(TerminalReadyLineDetector.isReadyLine("[info] Listening on port: 49152", port: 49152))
        XCTAssertTrue(TerminalReadyLineDetector.isReadyLine("ttyd listening at 127.0.0.1:49152", port: 49152))
        XCTAssertFalse(TerminalReadyLineDetector.isReadyLine("Listening on port: 49153", port: 49152))
        XCTAssertFalse(TerminalReadyLineDetector.isReadyLine("starting ttyd", port: 49152))
    }
}
