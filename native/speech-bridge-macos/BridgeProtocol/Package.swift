// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "TeraxSpeechBridgeProtocol",
  platforms: [.macOS("15.0")],
  products: [
    .library(
      name: "TeraxSpeechBridgeProtocol",
      targets: ["TeraxSpeechBridgeProtocol"]
    )
  ],
  targets: [
    .target(name: "TeraxSpeechBridgeProtocol"),
    .testTarget(
      name: "TeraxSpeechBridgeProtocolTests",
      dependencies: ["TeraxSpeechBridgeProtocol"]
    ),
  ]
)
