# macOS speech bridge

The bridge links speech-swift 0.0.21 directly and targets Apple silicon on macOS 15 or newer. Run the preparation script before building:

```bash
./scripts/prepare-speech-swift.sh
swift test --package-path native/speech-bridge-macos/BridgeProtocol --configuration release
swift build --package-path native/speech-bridge-macos --disable-sandbox --disable-automatic-resolution
```

The script verifies the resolved speech-swift commit before applying the narrow Parakeet local-loader patch in `patches/`. The patch keeps Terax's revision-pinned model fully local after installation. Remove it when speech-swift exposes the equivalent API in a tagged release.
