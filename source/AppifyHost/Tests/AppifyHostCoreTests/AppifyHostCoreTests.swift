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
        XCTAssertEqual(config.aboutNotice?.links, [
            AppifyHostAboutLink(title: "Example Project", url: "https://example.com"),
            AppifyHostAboutLink(title: "Example License", url: "https://example.com/license"),
        ])
        XCTAssertNil(config.firstLaunchHelp)
        XCTAssertNil(config.sourceReference)
        XCTAssertEqual(config.serverDirectoryURL.path, "/Applications/SketchPad.app/Contents/Resources/AppServer")
        XCTAssertEqual(config.serverExecutableURL.path, "/Applications/SketchPad.app/Contents/Resources/AppServer/main.sh")
    }

    func testLoadsFolderMarkerConfiguration() throws {
        let config = try AppifyHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(documentMode: "folderMarker", extensionName: "worktree"),
            bundleURL: URL(fileURLWithPath: "/Applications/RepoTool.app")
        )

        XCTAssertEqual(config.documentMode, .folderMarker)
        XCTAssertEqual(config.documentClassName, "AppifyHostDocument")
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

    func testLoadsSourceReferenceConfiguration() throws {
        var plist = sampleInfoPlist(documentMode: "contentPackage")
        var hostSettings = try XCTUnwrap(plist["AppifyHost"] as? [String: Any])
        hostSettings["SourceReference"] = [
            "RepositoryURL": "https://github.com/example/SketchPad",
            "Commit": "abc123",
            "AppPath": "SketchPad.app",
            "SourceDirectory": "Contents/Resources/Runner",
        ]
        plist["AppifyHost"] = hostSettings

        let config = try AppifyHostConfigurationLoader.load(
            infoDictionary: plist,
            bundleURL: URL(fileURLWithPath: "/Applications/SketchPad.app")
        )

        XCTAssertEqual(config.sourceReference?.repositoryURL, "https://github.com/example/SketchPad")
        XCTAssertEqual(config.sourceReference?.commit, "abc123")
        XCTAssertEqual(config.sourceReference?.appPath, "SketchPad.app")
        XCTAssertEqual(config.sourceReference?.sourceDirectory, "Contents/Resources/Runner")
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

    func testContentPackageOrFileAcceptsFilesAndPackages() throws {
        let config = try AppifyHostConfigurationLoader.load(
            infoDictionary: sampleInfoPlist(documentMode: "contentPackageOrFile", extensionName: "web"),
            bundleURL: URL(fileURLWithPath: "/Applications/Web.app")
        )
        XCTAssertEqual(config.documentMode, .contentPackageOrFile)

        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: rootURL)
        }

        let markerFile = rootURL.appendingPathComponent("site.web")
        FileManager.default.createFile(atPath: markerFile.path, contents: Data())
        XCTAssertEqual(try PackageDocument.documentURL(forPackage: markerFile, configuration: config).path, markerFile.path)
        XCTAssertEqual(try PackageDocument.workingDirectory(forPackage: markerFile, configuration: config).path, rootURL.path)

        let emptyPackage = rootURL.appendingPathComponent("empty.web", isDirectory: true)
        try FileManager.default.createDirectory(at: emptyPackage, withIntermediateDirectories: false)
        XCTAssertEqual(try PackageDocument.documentURL(forPackage: emptyPackage, configuration: config).path, emptyPackage.path)
        XCTAssertEqual(try PackageDocument.workingDirectory(forPackage: emptyPackage, configuration: config).path, rootURL.path)

        FileManager.default.createFile(atPath: emptyPackage.appendingPathComponent(".DS_Store").path, contents: Data())
        XCTAssertEqual(try PackageDocument.workingDirectory(forPackage: emptyPackage, configuration: config).path, rootURL.path)

        let nonEmptyPackage = rootURL.appendingPathComponent("package.web", isDirectory: true)
        try FileManager.default.createDirectory(at: nonEmptyPackage, withIntermediateDirectories: false)
        FileManager.default.createFile(atPath: nonEmptyPackage.appendingPathComponent("index.html").path, contents: Data())
        XCTAssertEqual(try PackageDocument.documentURL(forPackage: nonEmptyPackage, configuration: config).path, nonEmptyPackage.path)
        XCTAssertEqual(try PackageDocument.workingDirectory(forPackage: nonEmptyPackage, configuration: config).path, nonEmptyPackage.path)

        let documentURL = PackageDocument.untitledDocumentURL(configuration: config, temporaryDirectory: rootURL)
        try PackageDocument.createUntitledDocument(at: documentURL, configuration: config)
        var isDirectory: ObjCBool = false
        XCTAssertTrue(FileManager.default.fileExists(atPath: documentURL.path, isDirectory: &isDirectory))
        XCTAssertFalse(isDirectory.boolValue)
    }

    func testParsesDeepLinkSchemesFromInfoPlist() throws {
        var plist = sampleInfoPlist(documentMode: "contentPackageOrFile", extensionName: "web")
        plist["CFBundleURLTypes"] = [
            [
                "CFBundleURLName": "Web Deep Links",
                "CFBundleURLSchemes": ["dotweb", "DOTWEB", " dotweb "],
            ],
        ]

        let config = try AppifyHostConfigurationLoader.load(
            infoDictionary: plist,
            bundleURL: URL(fileURLWithPath: "/Applications/Web.app")
        )

        XCTAssertEqual(config.deepLinkSchemes, ["dotweb"])
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

    func testParsesDeepLinks() throws {
        let deepLink = try AppifyHostDeepLink.parse(
            URL(string: "dotweb://open?document=/tmp/Site.web&route=%2Fdocs%2Findex.html%3Fq%3D1%23top")!,
            allowedSchemes: ["dotweb"]
        )

        XCTAssertEqual(deepLink.command, .open)
        XCTAssertEqual(deepLink.documentURL?.path, "/tmp/Site.web")
        XCTAssertEqual(deepLink.route, "/docs/index.html?q=1#top")
    }

    func testRejectsUnsafeDeepLinks() throws {
        XCTAssertThrowsError(try AppifyHostDeepLink.parse(
            URL(string: "other://open?document=/tmp/Site.web")!,
            allowedSchemes: ["dotweb"]
        ))
        XCTAssertThrowsError(try AppifyHostDeepLink.parse(
            URL(string: "dotweb://open?document=relative.web")!,
            allowedSchemes: ["dotweb"]
        ))
        XCTAssertThrowsError(try AppifyHostDeepLink.parse(
            URL(string: "dotweb://open?document=/tmp/Site.web&route=%2F..%2Fsecret")!,
            allowedSchemes: ["dotweb"]
        ))
    }

    func testAppliesDeepLinkRoutesToReadyURL() throws {
        let readyURL = URL(string: "http://127.0.0.1:49152/")!
        let routedURL = try AppifyHostOpenURL.readyURL(readyURL, routedTo: "/docs/index.html?q=1#top")

        XCTAssertEqual(routedURL.absoluteString, "http://127.0.0.1:49152/docs/index.html?q=1#top")

        let packagedReadyURL = URL(string: "http://127.0.0.1:49152/apps/dashboard.web/")!
        let packagedRoutedURL = try AppifyHostOpenURL.readyURL(packagedReadyURL, routedTo: "/docs/index.html?q=1#top")

        XCTAssertEqual(
            packagedRoutedURL.absoluteString,
            "http://127.0.0.1:49152/apps/dashboard.web/docs/index.html?q=1#top"
        )
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

    func testClassifiesClickedExternalHTTPNavigation() throws {
        let context = sampleNavigationContext()

        XCTAssertEqual(AppifyHostOpenURL.userNavigationDisposition(
            for: URL(string: "https://jsoncanvas.org/spec/1.0")!,
            readyURL: context.readyURL,
            documentURL: context.documentURL,
            bundleURL: context.bundleURL,
            restrictToReadyURLScope: true
        ), .openExternally)

        XCTAssertEqual(AppifyHostOpenURL.userNavigationDisposition(
            for: URL(string: "http://example.com/docs")!,
            readyURL: context.readyURL,
            documentURL: context.documentURL,
            bundleURL: context.bundleURL,
            restrictToReadyURLScope: true
        ), .openExternally)
    }

    func testClassifiesClickedPromptedExternalSchemes() throws {
        let context = sampleNavigationContext()

        XCTAssertEqual(AppifyHostOpenURL.userNavigationDisposition(
            for: URL(string: "mailto:hello@example.com")!,
            readyURL: context.readyURL,
            documentURL: context.documentURL,
            bundleURL: context.bundleURL,
            restrictToReadyURLScope: true
        ), .askBeforeOpeningExternally)

        XCTAssertEqual(AppifyHostOpenURL.userNavigationDisposition(
            for: URL(string: "x-example://open/item")!,
            readyURL: context.readyURL,
            documentURL: context.documentURL,
            bundleURL: context.bundleURL,
            restrictToReadyURLScope: true
        ), .askBeforeOpeningExternally)
    }

    func testBlocksClickedPseudoSchemesAndSameOriginEscapes() throws {
        let context = sampleNavigationContext()

        for url in [
            URL(string: "javascript:alert(1)")!,
            URL(string: "data:text/html,%3Ch1%3Ebad%3C/h1%3E")!,
            URL(string: "blob:https://example.com/id")!,
            URL(string: "about:srcdoc")!,
            URL(string: "http://127.0.0.1:49152/server-secret/../other")!,
            URL(string: "http://127.0.0.1:49152/other")!,
        ] {
            XCTAssertEqual(AppifyHostOpenURL.userNavigationDisposition(
                for: url,
                readyURL: context.readyURL,
                documentURL: context.documentURL,
                bundleURL: context.bundleURL,
                restrictToReadyURLScope: true
            ), .block)
        }
    }

    func testAllowsClickedInHostNavigation() throws {
        let context = sampleNavigationContext()

        XCTAssertEqual(AppifyHostOpenURL.userNavigationDisposition(
            for: URL(string: "http://127.0.0.1:49152/server-secret/ws")!,
            readyURL: context.readyURL,
            documentURL: context.documentURL,
            bundleURL: context.bundleURL,
            restrictToReadyURLScope: true
        ), .allowInHost)
    }

    func testServerEnvironmentSanitizesLoaderHooks() {
        let environment = ServerEnvironmentBuilder.build(
            base: [
                "PATH": "/usr/local/bin",
                "HOME": "/Users/test",
                "BASH_ENV": "/tmp/payload",
                "DEVELOPER_DIR": "/nix/store/dead-apple-sdk",
                "DYLD_INSERT_LIBRARIES": "/tmp/lib.dylib",
                "LD_PRELOAD": "/tmp/lib.so",
                "SDKROOT": "/nix/store/dead-apple-sdk/SDKs/MacOSX.sdk",
            ],
            additional: ["APPIFY_HOST_DOCUMENT_PATH": "/tmp/doc"]
        )

        XCTAssertEqual(environment["PATH"], "/usr/local/bin")
        XCTAssertEqual(environment["HOME"], "/Users/test")
        XCTAssertEqual(environment["APPIFY_HOST_DOCUMENT_PATH"], "/tmp/doc")
        XCTAssertNil(environment["BASH_ENV"])
        XCTAssertNil(environment["DEVELOPER_DIR"])
        XCTAssertNil(environment["DYLD_INSERT_LIBRARIES"])
        XCTAssertNil(environment["LD_PRELOAD"])
        XCTAssertNil(environment["SDKROOT"])
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

    private struct NavigationContext {
        var readyURL: URL
        var documentURL: URL
        var bundleURL: URL
    }

    private func sampleNavigationContext() -> NavigationContext {
        NavigationContext(
            readyURL: URL(string: "http://127.0.0.1:49152/server-secret/")!,
            documentURL: URL(fileURLWithPath: "/tmp/repo/repo.worktree"),
            bundleURL: URL(fileURLWithPath: "/Applications/RepoTool.app")
        )
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
                    "Links": [
                        [
                            "Title": "Example License",
                            "URL": "https://example.com/license",
                        ],
                    ],
                ],
            ],
        ]
    }
}
