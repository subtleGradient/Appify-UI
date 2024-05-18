// swift-tools-version:5.3
import PackageDescription

let package = Package(
  name: "HelloWorldApp",
  platforms: [
    .macOS(.v10_15)
  ],
  products: [
    .executable(
      name: "HelloWorldApp",
      targets: ["HelloWorldApp"])
  ],
  dependencies: [],
  targets: [
    .target(
      name: "HelloWorldApp",
      dependencies: [],
      path: "Sources"
    )
  ]
)
