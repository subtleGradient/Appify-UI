// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "LazyGit",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "LazyGitCore", targets: ["LazyGitCore"]),
        .executable(name: "LazyGit", targets: ["LazyGit"]),
    ],
    targets: [
        .target(
            name: "LazyGitCore",
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        ),
        .executableTarget(
            name: "LazyGit",
            dependencies: ["LazyGitCore"],
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        ),
        .testTarget(
            name: "LazyGitCoreTests",
            dependencies: ["LazyGitCore"],
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        ),
    ]
)
