// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "TeraxSpeechBridge",
  platforms: [.macOS("15.0")],
  products: [
    .executable(name: "terax-speech-bridge", targets: ["TeraxSpeechBridge"])
  ],
  dependencies: [
    .package(path: "BridgeProtocol"),
    .package(
      url: "https://github.com/soniqo/speech-swift",
      exact: "0.0.21"
    ),
  ],
  targets: [
    .executableTarget(
      name: "TeraxSpeechBridge",
      dependencies: [
        .product(
          name: "TeraxSpeechBridgeProtocol",
          package: "bridgeprotocol"
        ),
        .product(name: "NemotronStreamingASR", package: "speech-swift"),
        .product(name: "ParakeetStreamingASR", package: "speech-swift"),
      ]
    )
  ]
)
