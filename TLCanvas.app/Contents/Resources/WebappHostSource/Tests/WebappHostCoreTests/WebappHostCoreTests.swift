import XCTest
@testable import WebappHostCore

final class WebappHostCoreTests: XCTestCase {
    func testLoadsConfigurationFromInfoPlistFacts() throws {
        let config = try WebappHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(),
            bundleURL: URL(fileURLWithPath: "/Applications/TLCanvas.app")
        )

        XCTAssertEqual(config.appName, "TLCanvas")
        XCTAssertEqual(config.bundleIdentifier, "com.subtlegradient.tlcanvas")
        XCTAssertEqual(config.documentExtensions, ["tlcanvas"])
        XCTAssertEqual(config.documentContentTypes, ["com.subtlegradient.tlcanvas"])
        XCTAssertEqual(config.documentClassName, "WebappHostDocument")
        XCTAssertEqual(config.documentKindEnvironmentValue, "com.subtlegradient.tlcanvas")
        XCTAssertEqual(config.runnerInstallDirectory, "Contents/Resources/Runner")
        XCTAssertEqual(config.runnerEntry, "src/index.ts")
        XCTAssertEqual(config.runnerArguments, ["--quiet"])
        XCTAssertEqual(config.logName, "TLCanvas")
        XCTAssertEqual(config.aboutNotice?.message, "Built with the tldraw SDK.")
        XCTAssertEqual(config.aboutNotice?.linkTitle, "Official tldraw SDK")
        XCTAssertEqual(config.aboutNotice?.linkURL, "https://tldraw.dev")
        XCTAssertEqual(config.runnerDirectoryURL.path, "/Applications/TLCanvas.app/Contents/Resources/Runner")
    }

    func testBuildsBunCommandWithoutDuplicatingBundleFacts() throws {
        let config = try WebappHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(),
            bundleURL: URL(fileURLWithPath: "/tmp/TLCanvas.app")
        )

        let command = try RunnerCommandBuilder.command(
            bunURL: URL(fileURLWithPath: "/opt/homebrew/bin/bun"),
            configuration: config,
            documentURL: URL(fileURLWithPath: "/tmp/Canvas.tlcanvas")
        )

        XCTAssertEqual(command.executableURL.path, "/opt/homebrew/bin/bun")
        XCTAssertEqual(command.currentDirectoryURL.path, "/tmp/TLCanvas.app/Contents/Resources/Runner")
        XCTAssertEqual(command.arguments, [
            "src/index.ts",
            "--quiet",
            "/tmp/Canvas.tlcanvas",
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
            bundleURL: URL(fileURLWithPath: "/tmp/TLCanvas.app")
        ))
    }

    func testParsesDocumentClassForMatchingDocumentKind() throws {
        XCTAssertEqual(
            WebappHostConfigurationLoader.parseDocumentClassName(
                from: sampleInfoPlist(),
                documentKind: "com.subtlegradient.tlcanvas"
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

    func testParsesDocumentContentTypesFromDocumentDeclarations() throws {
        XCTAssertEqual(
            WebappHostConfigurationLoader.parseDocumentContentTypes(from: sampleInfoPlist()),
            ["com.subtlegradient.tlcanvas"]
        )
    }

    func testParsesAboutNoticeFromWebappHostSettings() throws {
        let config = try WebappHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(),
            bundleURL: URL(fileURLWithPath: "/Applications/TLCanvas.app")
        )

        XCTAssertEqual(config.aboutNotice, WebappHostAboutNotice(
            message: "Built with the tldraw SDK.",
            linkTitle: "Official tldraw SDK",
            linkURL: "https://tldraw.dev"
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
        let documentURL = URL(fileURLWithPath: "/tmp/Canvas.tlcanvas")
        let bundleURL = URL(fileURLWithPath: "/Applications/TLCanvas.app")
        XCTAssertEqual(try WebappHostOpenURL.validate(extracted, documentURL: documentURL, bundleURL: bundleURL), extracted)

        let documentFileURL = URL(fileURLWithPath: "/tmp/Canvas.tlcanvas/index.html")
        XCTAssertEqual(try WebappHostOpenURL.validate(documentFileURL, documentURL: documentURL, bundleURL: bundleURL), documentFileURL)

        let bundleFileURL = URL(fileURLWithPath: "/Applications/TLCanvas.app/Contents/Resources/Runner/index.html")
        XCTAssertEqual(try WebappHostOpenURL.validate(bundleFileURL, documentURL: documentURL, bundleURL: bundleURL), bundleFileURL)
    }

    func testRejectsUnsafeRunnerOpenURLs() throws {
        let documentURL = URL(fileURLWithPath: "/tmp/Canvas.tlcanvas")
        let bundleURL = URL(fileURLWithPath: "/Applications/TLCanvas.app")
        let rejected = [
            URL(string: "https://example.com")!,
            URL(string: "http://192.168.1.5:8000")!,
            URL(fileURLWithPath: "/tmp/Other.tlcanvas/index.html"),
        ]

        for url in rejected {
            XCTAssertThrowsError(try WebappHostOpenURL.validate(url, documentURL: documentURL, bundleURL: bundleURL), url.absoluteString)
        }
    }

    private func sampleInfoPlist() -> [String: Any] {
        [
            "CFBundleDisplayName": "TLCanvas",
            "CFBundleIdentifier": "com.subtlegradient.tlcanvas",
            "CFBundleDocumentTypes": [
                [
                    "CFBundleTypeName": "TLCanvas Document",
                    "CFBundleTypeExtensions": ["tlcanvas"],
                    "LSItemContentTypes": ["com.subtlegradient.tlcanvas"],
                    "LSTypeIsPackage": true,
                    "NSDocumentClass": "WebappHostDocument",
                ],
            ],
            "UTExportedTypeDeclarations": [
                [
                    "UTTypeIdentifier": "com.subtlegradient.tlcanvas",
                    "UTTypeTagSpecification": [
                        "public.filename-extension": ["tlcanvas"],
                    ],
                ],
            ],
            "WebappHost": [
                "RunnerInstallDirectory": "Contents/Resources/Runner",
                "RunnerEntry": "src/index.ts",
                "RunnerArguments": ["--quiet"],
                "DocumentKindEnvironmentValue": "com.subtlegradient.tlcanvas",
                "LogName": "TLCanvas",
                "AboutNotice": [
                    "Message": "Built with the tldraw SDK.",
                    "LinkTitle": "Official tldraw SDK",
                    "LinkURL": "https://tldraw.dev",
                ],
            ],
        ]
    }
}
