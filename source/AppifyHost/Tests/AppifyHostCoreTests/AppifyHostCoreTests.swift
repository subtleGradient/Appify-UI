import XCTest
@testable import AppifyHostCore

final class AppifyHostCoreTests: XCTestCase {
    func testLoadsContentPackageConfigurationFromInfoPlistFacts() throws {
        let config = try AppifyHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(documentMode: "contentPackage"),
            bundleURL: URL(fileURLWithPath: "/Applications/SketchPad.app")
        )

        XCTAssertEqual(config.appName, "SketchPad")
        XCTAssertEqual(config.bundleIdentifier, "com.example.sketchpad")
        XCTAssertEqual(config.documentExtensions, ["sketchdoc"])
        XCTAssertEqual(config.documentContentTypes, ["com.example.sketchpad"])
        XCTAssertEqual(config.documentClassName, "AppifyHostDocument")
        XCTAssertEqual(config.documentMode, .contentPackage)
        XCTAssertEqual(config.documentKindEnvironmentValue, "com.example.sketchpad")
        XCTAssertEqual(config.serverInstallDirectory, "Contents/Resources/AppServer")
        XCTAssertEqual(config.serverExecutable, "main.sh")
        XCTAssertEqual(config.serverArguments, ["--quiet"])
        XCTAssertEqual(config.environmentVariables, ["EXAMPLE_DOCUMENT": "{documentPath}"])
        XCTAssertEqual(config.logName, "SketchPad")
        XCTAssertEqual(config.windowTitlePrefix, "SketchPad")
        XCTAssertEqual(config.webViewDataStore, .persistent)
        XCTAssertEqual(config.aboutNotice?.message, "Example host notice.")
        XCTAssertEqual(config.serverDirectoryURL.path, "/Applications/SketchPad.app/Contents/Resources/AppServer")
        XCTAssertEqual(config.serverExecutableURL.path, "/Applications/SketchPad.app/Contents/Resources/AppServer/main.sh")
    }

    func testLoadsFolderMarkerConfiguration() throws {
        let config = try AppifyHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(documentMode: "folderMarker", extensionName: "worktree"),
            bundleURL: URL(fileURLWithPath: "/Applications/RepoTool.app")
        )

        XCTAssertEqual(config.documentMode, .folderMarker)
        XCTAssertEqual(config.webViewDataStore, .nonPersistent)
    }

    func testBuildsGenericServerCommand() throws {
        let config = try sampleConfig()
        let command = try ServerCommandBuilder.command(
            configuration: config,
            templateValues: TemplateValues(
                bundleURL: URL(fileURLWithPath: "/tmp/SketchPad.app"),
                documentURL: URL(fileURLWithPath: "/tmp/Canvas.sketchdoc"),
                workingDirectory: URL(fileURLWithPath: "/tmp/Canvas.sketchdoc")
            )
        )

        XCTAssertEqual(command.executableURL.path, "/tmp/SketchPad.app/Contents/Resources/AppServer/main.sh")
        XCTAssertEqual(command.currentDirectoryURL.path, "/tmp/SketchPad.app/Contents/Resources/AppServer")
        XCTAssertEqual(command.arguments, ["--quiet"])
    }

    func testTemplateExpansionBuildsConfiguredEnvironment() throws {
        let expanded = TemplateExpander.expand(
            [
                "DOC": "{documentPath}",
                "WORK": "{workingDirectory}",
                "BUNDLE": "{bundlePath}",
            ],
            templateValues: TemplateValues(
                bundleURL: URL(fileURLWithPath: "/tmp/App.app"),
                documentURL: URL(fileURLWithPath: "/tmp/repo/repo.worktree"),
                workingDirectory: URL(fileURLWithPath: "/tmp/repo")
            )
        )

        XCTAssertEqual(expanded["DOC"], "/tmp/repo/repo.worktree")
        XCTAssertEqual(expanded["WORK"], "/tmp/repo")
        XCTAssertEqual(expanded["BUNDLE"], "/tmp/App.app")
    }

    func testRejectsUnsafeServerTokens() throws {
        var plist = sampleInfoPlist(documentMode: "contentPackage")
        plist["AppifyHost"] = [
            "ServerExecutable": "../escape.sh",
            "ServerArguments": [],
        ]

        XCTAssertThrowsError(try AppifyHostConfigurationLoader.load(
            infoDictionary: plist,
            bundleURL: URL(fileURLWithPath: "/tmp/SketchPad.app")
        ))
    }

    func testPackageURLAndWorkingDirectoryForFolderMarkers() throws {
        let config = try AppifyHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(documentMode: "folderMarker", extensionName: "worktree"),
            bundleURL: URL(fileURLWithPath: "/tmp/RepoTool.app")
        )
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let folderURL = rootURL.appendingPathComponent("My Repo", isDirectory: true)
        try FileManager.default.createDirectory(at: folderURL, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: rootURL)
        }

        let packageURL = PackageDocument.packageURL(forFolder: folderURL, configuration: config)
        try FileManager.default.createDirectory(at: packageURL, withIntermediateDirectories: false)

        XCTAssertEqual(packageURL.lastPathComponent, "my-repo.worktree")
        XCTAssertEqual(try PackageDocument.workingDirectory(forPackage: packageURL, configuration: config).path, folderURL.path)
    }

    func testContentPackageWorkingDirectoryIsThePackageItself() throws {
        let config = try sampleConfig()
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let packageURL = rootURL.appendingPathComponent("Canvas.sketchdoc", isDirectory: true)
        try FileManager.default.createDirectory(at: packageURL, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: rootURL)
        }

        XCTAssertEqual(try PackageDocument.workingDirectory(forPackage: packageURL, configuration: config).path, packageURL.path)
    }

    func testExtractsAndValidatesReadyURLs() throws {
        let extracted = try XCTUnwrap(AppifyHostOpenURL.extract(from: "APPIFY_HOST_OPEN_URL=http://127.0.0.1:8787/app/"))
        let documentURL = URL(fileURLWithPath: "/tmp/Canvas.sketchdoc")
        let bundleURL = URL(fileURLWithPath: "/Applications/SketchPad.app")
        XCTAssertEqual(try AppifyHostOpenURL.validateReadyURL(extracted, documentURL: documentURL, bundleURL: bundleURL), extracted)

        let documentFileURL = URL(fileURLWithPath: "/tmp/Canvas.sketchdoc/index.html")
        XCTAssertEqual(try AppifyHostOpenURL.validateReadyURL(documentFileURL, documentURL: documentURL, bundleURL: bundleURL), documentFileURL)
    }

    func testRestrictsNavigationToReadyURLScope() throws {
        let readyURL = URL(string: "http://127.0.0.1:49152/server-secret/")!
        let documentURL = URL(fileURLWithPath: "/tmp/repo/repo.worktree")
        let bundleURL = URL(fileURLWithPath: "/Applications/RepoTool.app")

        XCTAssertTrue(AppifyHostOpenURL.isAllowedNavigation(
            URL(string: "http://127.0.0.1:49152/server-secret/ws")!,
            readyURL: readyURL,
            documentURL: documentURL,
            bundleURL: bundleURL,
            restrictToReadyURLScope: true
        ))
        XCTAssertFalse(AppifyHostOpenURL.isAllowedNavigation(
            URL(string: "http://127.0.0.1:49152/other")!,
            readyURL: readyURL,
            documentURL: documentURL,
            bundleURL: bundleURL,
            restrictToReadyURLScope: true
        ))
    }

    func testServerEnvironmentSanitizesLoaderHooks() {
        let environment = ServerEnvironmentBuilder.build(
            base: [
                "PATH": "/usr/local/bin",
                "HOME": "/Users/test",
                "BASH_ENV": "/tmp/payload",
                "DYLD_INSERT_LIBRARIES": "/tmp/lib.dylib",
                "LD_PRELOAD": "/tmp/lib.so",
            ],
            additional: ["APPIFY_HOST_DOCUMENT_PATH": "/tmp/doc"]
        )

        XCTAssertEqual(environment["PATH"], "/usr/local/bin")
        XCTAssertEqual(environment["HOME"], "/Users/test")
        XCTAssertEqual(environment["APPIFY_HOST_DOCUMENT_PATH"], "/tmp/doc")
        XCTAssertNil(environment["BASH_ENV"])
        XCTAssertNil(environment["DYLD_INSERT_LIBRARIES"])
        XCTAssertNil(environment["LD_PRELOAD"])
    }

    func testProcessTreeCollectsDescendants() {
        let entries = ProcessTree.parsePSOutput("""
          10   1
          11  10
          12  11
          13  10
          14  99
        """)

        XCTAssertEqual(ProcessTree.descendantPIDs(rootPID: 10, entries: entries), [12, 11, 13])
    }

    private func sampleConfig() throws -> AppifyHostConfiguration {
        try AppifyHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(documentMode: "contentPackage"),
            bundleURL: URL(fileURLWithPath: "/tmp/SketchPad.app")
        )
    }

    private func sampleInfoPlist(documentMode: String, extensionName: String = "sketchdoc") -> [String: Any] {
        let appName = extensionName == "worktree" ? "RepoTool" : "SketchPad"
        let typeIdentifier = extensionName == "worktree" ? "com.example.worktree" : "com.example.sketchpad"
        return [
            "CFBundleDisplayName": appName,
            "CFBundleIdentifier": typeIdentifier,
            "CFBundleDocumentTypes": [
                [
                    "CFBundleTypeName": "\(appName) Document",
                    "CFBundleTypeExtensions": [extensionName],
                    "LSItemContentTypes": [typeIdentifier],
                    "LSTypeIsPackage": true,
                    "NSDocumentClass": "AppifyHostDocument",
                ],
            ],
            "UTExportedTypeDeclarations": [
                [
                    "UTTypeIdentifier": typeIdentifier,
                    "UTTypeTagSpecification": [
                        "public.filename-extension": [extensionName],
                    ],
                ],
            ],
            "AppifyHost": [
                "DocumentMode": documentMode,
                "DocumentKindEnvironmentValue": typeIdentifier,
                "ServerInstallDirectory": "Contents/Resources/AppServer",
                "ServerExecutable": "main.sh",
                "ServerArguments": ["--quiet"],
                "EnvironmentVariables": [
                    "EXAMPLE_DOCUMENT": "{documentPath}",
                ],
                "LogName": appName,
                "WindowTitlePrefix": appName,
                "WebViewDataStore": extensionName == "worktree" ? "nonPersistent" : "persistent",
                "AboutNotice": [
                    "Message": "Example host notice.",
                    "LinkTitle": "Example Project",
                    "LinkURL": "https://example.com",
                ],
            ],
        ]
    }
}
