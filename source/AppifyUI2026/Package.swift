// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "AppifyUI2026",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "AppifyUI2026Core", targets: ["AppifyUI2026Core"]),
        .executable(name: "AppifyUI2026", targets: ["AppifyUI2026"]),
    ],
    targets: [
        .target(
            name: "AppifyUI2026Core",
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        ),
        .executableTarget(
            name: "AppifyUI2026",
            dependencies: ["AppifyUI2026Core"],
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        ),
        .testTarget(
            name: "AppifyUI2026CoreTests",
            dependencies: ["AppifyUI2026Core"],
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        ),
    ]
)
