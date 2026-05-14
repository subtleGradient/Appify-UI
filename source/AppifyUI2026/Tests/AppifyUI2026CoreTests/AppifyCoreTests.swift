import XCTest
@testable import AppifyUI2026Core

final class AppifyCoreTests: XCTestCase {
    private let validCommit = "e796a9c1f850d5984a6a1b46714b0869527249e9"

    func testManifestFileNameIsJSON() {
        XCTAssertEqual(WebappManifestLoader.manifestFileName, "webapp.json")
    }

    func testParsesValidWebappManifest() throws {
        let manifest = try WebappManifestLoader.parse("""
        {
          "type": "appify.webapp",
          "version": 1,
          "title": "Hello",
          "runner": {
            "package": "github:subtleGradient/web-native#\(validCommit)",
            "bin": "web-native-chat",
            "args": ["serve", "--quiet"]
          }
        }
        """)

        XCTAssertEqual(manifest.type, "appify.webapp")
        XCTAssertEqual(manifest.version, 1)
        XCTAssertEqual(manifest.title, "Hello")
        XCTAssertEqual(manifest.runner.package, "github:subtleGradient/web-native#\(validCommit)")
        XCTAssertEqual(manifest.runner.bin, "web-native-chat")
        XCTAssertEqual(manifest.runner.args, ["serve", "--quiet"])
    }

    func testRejectsUntrustedRunnerPackages() throws {
        let invalidPackages = [
            "github:other/web-native#\(validCommit)",
            "github:subtleGradient/web-native#main",
            "github:subtleGradient/web-native#v1.0.0",
            "https://github.com/subtleGradient/web-native.git#\(validCommit)",
            "@subtlegradient/web-native",
            "github:subtleGradient/web-native;rm -rf ~#\(validCommit)",
        ]

        for package in invalidPackages {
            XCTAssertThrowsError(try WebappManifestLoader.parse("""
            {
              "type": "appify.webapp",
              "version": 1,
              "runner": {
                "package": "\(package)",
                "bin": "web-native-chat",
                "args": []
              }
            }
            """), package)
        }
    }

    func testRejectsShellLikeBinAndArgs() throws {
        let unsafePairs: [(String, String)] = [
            ("./run", "serve"),
            ("web-native-chat", "serve;rm"),
            ("web-native-chat", "$(touch nope)"),
            ("web native", "serve"),
        ]

        for (bin, arg) in unsafePairs {
            XCTAssertThrowsError(try WebappManifestLoader.parse("""
            {
              "type": "appify.webapp",
              "version": 1,
              "runner": {
                "package": "github:subtleGradient/web-native#\(validCommit)",
                "bin": "\(bin)",
                "args": ["\(arg)"]
              }
            }
            """), "\(bin) \(arg)")
        }
    }

    func testRejectsMissingRequiredManifestFields() throws {
        let manifests = [
            """
            {
              "version": 1,
              "runner": {
                "package": "github:subtleGradient/web-native#\(validCommit)",
                "bin": "web-native-chat",
                "args": []
              }
            }
            """,
            """
            {
              "type": "appify.webapp",
              "runner": {
                "package": "github:subtleGradient/web-native#\(validCommit)",
                "bin": "web-native-chat",
                "args": []
              }
            }
            """,
            """
            {
              "type": "appify.webapp",
              "version": 1,
              "runner": {
                "bin": "web-native-chat",
                "args": []
              }
            }
            """,
        ]

        for manifest in manifests {
            XCTAssertThrowsError(try WebappManifestLoader.parse(manifest))
        }
    }

    func testBuildsExactBunXArguments() throws {
        let manifest = WebappManifest(
            type: "appify.webapp",
            version: 1,
            title: "Hello",
            runner: RunnerManifest(
                package: "github:subtleGradient/web-native#\(validCommit)",
                bin: "web-native-chat",
                args: ["serve"]
            )
        )
        let documentURL = URL(fileURLWithPath: "/tmp/Hello.webapp")

        let command = try RunnerCommandBuilder.command(
            bunURL: URL(fileURLWithPath: "/opt/homebrew/bin/bun"),
            manifest: manifest,
            documentURL: documentURL
        )

        XCTAssertEqual(command.executableURL.path, "/opt/homebrew/bin/bun")
        XCTAssertEqual(command.arguments, [
            "x",
            "--bun",
            "--package",
            "github:subtleGradient/web-native#\(validCommit)",
            "web-native-chat",
            "serve",
            "/tmp/Hello.webapp",
        ])
    }

    func testBunResolverUsesEnvironmentThenCommonPathsThenPath() throws {
        let environmentResolver = BunResolver(
            environment: ["APPIFY_BUN": "/custom/bun"],
            homeDirectory: URL(fileURLWithPath: "/Users/test"),
            isExecutableFile: { $0 == "/custom/bun" }
        )
        XCTAssertEqual(try environmentResolver.resolve().path, "/custom/bun")

        let commonPathResolver = BunResolver(
            environment: [:],
            homeDirectory: URL(fileURLWithPath: "/Users/test"),
            isExecutableFile: { $0 == "/Users/test/.bun/bin/bun" }
        )
        XCTAssertEqual(try commonPathResolver.resolve().path, "/Users/test/.bun/bin/bun")

        let pathResolver = BunResolver(
            environment: ["PATH": "/bin:/toolchain/bin"],
            homeDirectory: URL(fileURLWithPath: "/Users/test"),
            isExecutableFile: { $0 == "/toolchain/bin/bun" }
        )
        XCTAssertEqual(try pathResolver.resolve().path, "/toolchain/bin/bun")
    }

    func testExtractsAndValidatesRunnerOpenURL() throws {
        let extracted = try XCTUnwrap(AppifyOpenURL.extract(from: "APPIFY_OPEN_URL=http://127.0.0.1:8787/?token=abc"))
        let documentURL = URL(fileURLWithPath: "/tmp/Hello.webapp")
        XCTAssertEqual(try AppifyOpenURL.validate(extracted, documentURL: documentURL), extracted)

        let fileURL = URL(fileURLWithPath: "/tmp/Hello.webapp/index.html")
        XCTAssertEqual(try AppifyOpenURL.validate(fileURL, documentURL: documentURL), fileURL)
    }

    func testRejectsUnsafeRunnerOpenURLs() throws {
        let documentURL = URL(fileURLWithPath: "/tmp/Hello.webapp")
        let rejected = [
            URL(string: "https://example.com")!,
            URL(string: "http://192.168.1.5:8000")!,
            URL(fileURLWithPath: "/tmp/Other.webapp/index.html"),
        ]

        for url in rejected {
            XCTAssertThrowsError(try AppifyOpenURL.validate(url, documentURL: documentURL), url.absoluteString)
        }
    }
}
