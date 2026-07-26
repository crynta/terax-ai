import Foundation
import NemotronStreamingASR
import ParakeetStreamingASR
import TeraxSpeechBridgeProtocol

@main
struct TeraxSpeechBridge {
  static func main() async {
    let host = ModelHost()
    let input = FileHandle.standardInput
    let output = FileHandle.standardOutput

    while true {
      do {
        guard let request = try BridgeRequest.read(from: input) else { return }
        switch request.operation {
        case .ping:
          try BridgeResponse.write(
            to: output,
            profile: request.profile,
            result: .success("ready")
          )
        case .shutdown:
          try BridgeResponse.write(
            to: output,
            profile: request.profile,
            result: .success("bye")
          )
          return
        case .transcribe:
          do {
            let text = try await host.transcribe(request)
            try BridgeResponse.write(
              to: output,
              profile: request.profile,
              result: .success(text)
            )
          } catch {
            try BridgeResponse.write(
              to: output,
              profile: request.profile,
              result: .failure(error)
            )
          }
        }
      } catch {
        try? BridgeResponse.write(
          to: output,
          profile: .nemotron,
          result: .failure(error)
        )
        return
      }
    }
  }
}

private final class ModelHost {
  private var nemotron: NemotronStreamingASRModel?
  private var parakeet: ParakeetStreamingASRModel?

  func transcribe(_ request: BridgeRequest) async throws -> String {
    switch request.profile {
    case .nemotron:
      if nemotron == nil {
        parakeet?.unload()
        parakeet = nil
        let loaded = try await NemotronStreamingASRModel.fromLocal(
          bundleDir: try modelDirectory(
            modelId: NemotronStreamingASRModel.defaultModelId
          )
        )
        do {
          try loaded.warmUp()
        } catch {
          loaded.unload()
          throw error
        }
        nemotron = loaded
      }
      return try nemotron?.transcribeAudio(
        request.samples,
        sampleRate: Int(request.sampleRate),
        language: request.language.isEmpty ? nil : request.language,
        padSilence: false
      ) ?? ""
    case .parakeet:
      if parakeet == nil {
        nemotron?.unload()
        nemotron = nil
        let loaded = try await ParakeetStreamingASRModel.fromLocal(
          bundleDir: try modelDirectory(
            modelId: ParakeetStreamingASRModel.defaultModelId
          )
        )
        do {
          try loaded.warmUp()
        } catch {
          loaded.unload()
          throw error
        }
        parakeet = loaded
      }
      return try parakeet?.transcribeAudio(
        request.samples,
        sampleRate: Int(request.sampleRate),
        language: request.language.isEmpty ? nil : request.language
      ) ?? ""
    }
  }

  private func modelDirectory(modelId: String) throws -> URL {
    guard let root = ProcessInfo.processInfo.environment["TERAX_SPEECH_SWIFT_MODEL_DIR"],
      !root.isEmpty
    else {
      throw ModelHostError("TERAX_SPEECH_SWIFT_MODEL_DIR is not set")
    }
    return URL(fileURLWithPath: root, isDirectory: true)
      .appendingPathComponent(modelId, isDirectory: true)
  }
}

private struct ModelHostError: Error, CustomStringConvertible {
  let description: String

  init(_ description: String) {
    self.description = description
  }
}
