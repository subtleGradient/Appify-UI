import XCTest
@testable import WebappHostCore

final class WebappHostCoreTests: XCTestCase {
    func testLoadsConfigurationFromInfoPlistFacts() throws {
        let config = try WebappHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(),
            bundleURL: URL(fileURLWithPath: "/Applications/tldraw.app")
        )

        XCTAssertEqual(config.appName, "tldraw")
        XCTAssertEqual(config.bundleIdentifier, "com.subtlegradient.tldraw")
        XCTAssertEqual(config.documentExtensions, ["tldraw"])
        XCTAssertEqual(config.documentClassName, "WebappHostDocument")
        XCTAssertEqual(config.documentKindEnvironmentValue, "com.subtlegradient.tldraw-canvas")
        XCTAssertEqual(config.runnerInstallDirectory, "Contents/Resources/Runner")
        XCTAssertEqual(config.runnerEntry, "src/index.ts")
        XCTAssertEqual(config.runnerArguments, ["--quiet"])
        XCTAssertEqual(config.logName, "tldraw")
        XCTAssertEqual(config.runnerDirectoryURL.path, "/Applications/tldraw.app/Contents/Resources/Runner")
    }

    func testParsesDocumentClassForMatchingDocumentKind() throws {
        XCTAssertEqual(
            WebappHostConfigurationLoader.parseDocumentClassName(
                from: sampleInfoPlist(),
                documentKind: "com.subtlegradient.tldraw-canvas"
            ),
            "WebappHostDocument"
        )
        XCTAssertNil(
            WebappHostConfigurationLoader.parseDocumentClassName(
                from: sampleInfoPlist(),
                documentKind: "com.example.other"
            )
        )
    }

    func testBuildsBunCommandWithoutDuplicatingBundleFacts() throws {
        let config = try WebappHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(),
            bundleURL: URL(fileURLWithPath: "/tmp/tldraw.app")
        )

        let command = try RunnerCommandBuilder.command(
            bunURL: URL(fileURLWithPath: "/opt/homebrew/bin/bun"),
            configuration: config,
            documentURL: URL(fileURLWithPath: "/tmp/Canvas.tldraw")
        )

        XCTAssertEqual(command.executableURL.path, "/opt/homebrew/bin/bun")
        XCTAssertEqual(command.currentDirectoryURL.path, "/tmp/tldraw.app/Contents/Resources/Runner")
        XCTAssertEqual(command.arguments, [
            "src/index.ts",
            "--quiet",
            "/tmp/Canvas.tldraw",
        ])
    }

    func testRejectsUnsafeRunnerTokens() throws {
        var plist = sampleInfoPlist()
        plist["WebappHost"] = [
            "RunnerEntry": "../escape.ts",
            "RunnerArguments": [],
        ]

        XCTAssertThrowsError(try WebappHostConfigurationLoader.load(
            infoDictionary: plist,
            bundleURL: URL(fileURLWithPath: "/tmp/tldraw.app")
        ))
    }

    func testBunResolverUsesEnvironmentThenCommonPathsThenPath() throws {
        let environmentResolver = BunResolver(
            environment: ["WEBAPP_HOST_BUN": "/custom/bun"],
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
        let extracted = try XCTUnwrap(WebappHostOpenURL.extract(from: "WEBAPP_HOST_OPEN_URL=http://127.0.0.1:8787/?token=abc"))
        let documentURL = URL(fileURLWithPath: "/tmp/Canvas.tldraw")
        let bundleURL = URL(fileURLWithPath: "/Applications/tldraw.app")
        XCTAssertEqual(try WebappHostOpenURL.validate(extracted, documentURL: documentURL, bundleURL: bundleURL), extracted)

        let documentFileURL = URL(fileURLWithPath: "/tmp/Canvas.tldraw/index.html")
        XCTAssertEqual(try WebappHostOpenURL.validate(documentFileURL, documentURL: documentURL, bundleURL: bundleURL), documentFileURL)

        let bundleFileURL = URL(fileURLWithPath: "/Applications/tldraw.app/Contents/Resources/Runner/index.html")
        XCTAssertEqual(try WebappHostOpenURL.validate(bundleFileURL, documentURL: documentURL, bundleURL: bundleURL), bundleFileURL)
    }

    func testRejectsUnsafeRunnerOpenURLs() throws {
        let documentURL = URL(fileURLWithPath: "/tmp/Canvas.tldraw")
        let bundleURL = URL(fileURLWithPath: "/Applications/tldraw.app")
        let rejected = [
            URL(string: "https://example.com")!,
            URL(string: "http://192.168.1.5:8000")!,
            URL(fileURLWithPath: "/tmp/Other.tldraw/index.html"),
        ]

        for url in rejected {
            XCTAssertThrowsError(try WebappHostOpenURL.validate(url, documentURL: documentURL, bundleURL: bundleURL), url.absoluteString)
        }
    }

    private func sampleInfoPlist() -> [String: Any] {
        [
            "CFBundleDisplayName": "tldraw",
            "CFBundleIdentifier": "com.subtlegradient.tldraw",
            "CFBundleDocumentTypes": [
                [
                    "CFBundleTypeName": "tldraw Canvas",
                    "CFBundleTypeExtensions": ["tldraw"],
                    "LSItemContentTypes": ["com.subtlegradient.tldraw-canvas"],
                    "LSTypeIsPackage": true,
                    "NSDocumentClass": "WebappHostDocument",
                ],
            ],
            "UTExportedTypeDeclarations": [
                [
                    "UTTypeIdentifier": "com.subtlegradient.tldraw-canvas",
                    "UTTypeTagSpecification": [
                        "public.filename-extension": ["tldraw"],
                    ],
                ],
            ],
            "WebappHost": [
                "RunnerInstallDirectory": "Contents/Resources/Runner",
                "RunnerEntry": "src/index.ts",
                "RunnerArguments": ["--quiet"],
                "DocumentKindEnvironmentValue": "com.subtlegradient.tldraw-canvas",
                "LogName": "tldraw",
            ],
        ]
    }
}
