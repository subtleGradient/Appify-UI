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
        XCTAssertEqual(config.startupTimeoutSeconds, 20)
        XCTAssertEqual(config.webViewDataStore, .persistent)
        XCTAssertEqual(config.aboutNotice?.message, "Example host notice.")
        XCTAssertNil(config.firstLaunchHelp)
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

    func testLoadsFileDocumentConfiguration() throws {
        let config = try AppifyHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(documentMode: "fileDocument", extensionName: "sqlite"),
            bundleURL: URL(fileURLWithPath: "/Applications/SQLite Peek.app")
        )

        XCTAssertEqual(config.appName, "SQLite Peek")
        XCTAssertEqual(config.bundleIdentifier, "com.example.sqlite")
        XCTAssertEqual(config.documentExtensions, ["sqlite"])
        XCTAssertEqual(config.documentClassName, "AppifyHostDocument")
        XCTAssertEqual(config.documentMode, .fileDocument)
        XCTAssertEqual(config.startupTimeoutSeconds, 600)
    }

    func testLoadsFirstLaunchHelpConfiguration() throws {
        var plist = sampleInfoPlist(documentMode: "fileDocument", extensionName: "sqlite")
        var hostSettings = try XCTUnwrap(plist["AppifyHost"] as? [String: Any])
        hostSettings["FirstLaunchHelp"] = [
            "URL": "https://example.com/keybindings",
            "WindowTitle": "Useful Keybindings",
        ]
        plist["AppifyHost"] = hostSettings

        let config = try AppifyHostConfigurationLoader.load(
            infoDictionary: plist,
            bundleURL: URL(fileURLWithPath: "/Applications/tw.app")
        )

        XCTAssertEqual(config.firstLaunchHelp?.url.absoluteString, "https://example.com/keybindings")
        XCTAssertEqual(config.firstLaunchHelp?.windowTitle, "Useful Keybindings")
    }

    func testRejectsInvalidFirstLaunchHelpURL() throws {
        var plist = sampleInfoPlist(documentMode: "fileDocument", extensionName: "sqlite")
        var hostSettings = try XCTUnwrap(plist["AppifyHost"] as? [String: Any])
        hostSettings["FirstLaunchHelp"] = [
            "URL": "file:///tmp/help.html",
        ]
        plist["AppifyHost"] = hostSettings

        XCTAssertThrowsError(try AppifyHostConfigurationLoader.load(
            infoDictionary: plist,
            bundleURL: URL(fileURLWithPath: "/Applications/tw.app")
        ))
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

    func testRejectsInvalidStartupTimeout() throws {
        var plist = sampleInfoPlist(documentMode: "contentPackage")
        plist["AppifyHost"] = [
            "DocumentMode": "contentPackage",
            "ServerExecutable": "main.sh",
            "StartupTimeoutSeconds": 0,
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

    func testFileDocumentWorkingDirectoryIsTheContainingFolder() throws {
        let config = try AppifyHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(documentMode: "fileDocument", extensionName: "sqlite"),
            bundleURL: URL(fileURLWithPath: "/Applications/SQLite Peek.app")
        )
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

    func testUntitledDocumentURLUsesTemporaryUntitledFileForFileDocuments() throws {
        let config = try AppifyHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(documentMode: "fileDocument", extensionName: "canvas"),
            bundleURL: URL(fileURLWithPath: "/Applications/JSONCanvas.app")
        )
        let tempRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer {
            try? FileManager.default.removeItem(at: tempRoot)
        }

        let documentURL = PackageDocument.untitledDocumentURL(configuration: config, temporaryDirectory: tempRoot)
        XCTAssertEqual(documentURL.lastPathComponent, "Untitled.canvas")
        XCTAssertTrue(documentURL.deletingLastPathComponent().path.hasPrefix(tempRoot.path))

        try PackageDocument.createUntitledDocument(at: documentURL, configuration: config)
        var isDirectory: ObjCBool = false
        XCTAssertTrue(FileManager.default.fileExists(atPath: documentURL.path, isDirectory: &isDirectory))
        XCTAssertFalse(isDirectory.boolValue)
        XCTAssertEqual(try PackageDocument.workingDirectory(forPackage: documentURL, configuration: config).path, documentURL.deletingLastPathComponent().path)
    }

    func testUntitledDocumentURLUsesTemporaryUntitledPackageForContentPackages() throws {
        let config = try sampleConfig()
        let tempRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer {
            try? FileManager.default.removeItem(at: tempRoot)
        }

        let documentURL = PackageDocument.untitledDocumentURL(configuration: config, temporaryDirectory: tempRoot)
        XCTAssertEqual(documentURL.lastPathComponent, "Untitled.sketchdoc")

        try PackageDocument.createUntitledDocument(at: documentURL, configuration: config)
        var isDirectory: ObjCBool = false
        XCTAssertTrue(FileManager.default.fileExists(atPath: documentURL.path, isDirectory: &isDirectory))
        XCTAssertTrue(isDirectory.boolValue)
        XCTAssertEqual(try PackageDocument.workingDirectory(forPackage: documentURL, configuration: config).path, documentURL.path)
    }

    func testFileDocumentAliasResolvesToTarget() throws {
        let config = try AppifyHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(documentMode: "fileDocument", extensionName: "sqlite"),
            bundleURL: URL(fileURLWithPath: "/Applications/SQLite Peek.app")
        )
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let targetFolder = rootURL.appendingPathComponent("iCloud Target", isDirectory: true)
        let aliasFolder = rootURL.appendingPathComponent("Alias Folder", isDirectory: true)
        try FileManager.default.createDirectory(at: targetFolder, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: aliasFolder, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: rootURL)
        }

        let databaseFile = targetFolder.appendingPathComponent("magpdf.sqlite")
        FileManager.default.createFile(atPath: databaseFile.path, contents: Data())
        let aliasFile = aliasFolder.appendingPathComponent("magpdf.sqlite")
        let bookmarkData = try databaseFile.bookmarkData(
            options: .suitableForBookmarkFile,
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        try URL.writeBookmarkData(bookmarkData, to: aliasFile)

        XCTAssertEqual(try PackageDocument.documentURL(forPackage: aliasFile, configuration: config).path, databaseFile.path)
        XCTAssertEqual(try PackageDocument.workingDirectory(forPackage: aliasFile, configuration: config).path, targetFolder.path)
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
        let appName: String
        let typeIdentifier: String
        switch extensionName {
        case "worktree":
            appName = "RepoTool"
            typeIdentifier = "com.example.worktree"
        case "sqlite":
            appName = "SQLite Peek"
            typeIdentifier = "com.example.sqlite"
        default:
            appName = "SketchPad"
            typeIdentifier = "com.example.sketchpad"
        }
        let isPackage = documentMode != "fileDocument"
        return [
            "CFBundleDisplayName": appName,
            "CFBundleIdentifier": typeIdentifier,
            "CFBundleDocumentTypes": [
                [
                    "CFBundleTypeName": "\(appName) Document",
                    "CFBundleTypeExtensions": [extensionName],
                    "LSItemContentTypes": [typeIdentifier],
                    "LSTypeIsPackage": isPackage,
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
                "StartupTimeoutSeconds": extensionName == "sqlite" ? 600 : 20,
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
