// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "AppifyHost",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "AppifyHostCore", targets: ["AppifyHostCore"]),
        .executable(name: "appify-host", targets: ["appify-host"]),
    ],
    targets: [
        .target(
            name: "AppifyHostCore",
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        ),
        .executableTarget(
            name: "appify-host",
            dependencies: ["AppifyHostCore"],
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        ),
        .testTarget(
            name: "AppifyHostCoreTests",
            dependencies: ["AppifyHostCore"],
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        ),
    ]
)
