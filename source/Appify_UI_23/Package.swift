// swift-tools-version:5.3
import PackageDescription

let package = Package(
  name: "Appify_UI_23",
  platforms: [
    .macOS(.v11)
  ],
  products: [
    .executable(
      name: "Appify_UI_23",
      targets: ["Appify_UI_23"])
  ],
  dependencies: [],
  targets: [
    .target(
      name: "Appify_UI_23",
      dependencies: [],
      path: "Appify_UI_23",
      exclude: ["Appify_UI_23.entitlements"]  // Exclude non-source files
    )
  ]
)
