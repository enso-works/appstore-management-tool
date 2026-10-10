// swift-tools-version: 6.0
// The Mac app's model, built on its own so `swift test` checks it without launching the app.
import PackageDescription

let package = Package(
  name: "StoreShotsCore",
  platforms: [.macOS(.v14)],
  targets: [
    .target(
      name: "StoreShotsCore",
      path: "StoreShots",
      exclude: ["App", "Sections", "Info.plist", "StoreShotsApp.swift", "EditorServer.swift", "ServerProcess.swift",
        "AppSettings.swift", "Design/BackgroundInspector.swift", "Design/CanvasView.swift", "Design/DesignView.swift",
        "Design/Filmstrip.swift", "Design/InspectorView.swift", "Design/LayersInspector.swift", "Design/PageInspector.swift",
        "Design/Thumbnails.swift"],
      sources: ["Model", "Design/CSSColor.swift"]
    ),
    .testTarget(name: "StoreShotsCoreTests", dependencies: ["StoreShotsCore"], path: "Tests/StoreShotsCoreTests"),
  ]
)
