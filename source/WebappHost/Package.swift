// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "WebappHost",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "WebappHostCore", targets: ["WebappHostCore"]),
        .executable(name: "webapp-host", targets: ["webapp-host"]),
    ],
    targets: [
        .target(
            name: "WebappHostCore",
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        ),
        .executableTarget(
            name: "webapp-host",
            dependencies: ["WebappHostCore"],
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        ),
        .testTarget(
            name: "WebappHostCoreTests",
            dependencies: ["WebappHostCore"],
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        ),
    ]
)
