// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "TuiHost",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "TuiHostCore", targets: ["TuiHostCore"]),
        .executable(name: "tui-host", targets: ["tui-host"]),
    ],
    targets: [
        .target(
            name: "TuiHostCore",
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        ),
        .executableTarget(
            name: "tui-host",
            dependencies: ["TuiHostCore"],
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        ),
        .testTarget(
            name: "TuiHostCoreTests",
            dependencies: ["TuiHostCore"],
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        ),
    ]
)
