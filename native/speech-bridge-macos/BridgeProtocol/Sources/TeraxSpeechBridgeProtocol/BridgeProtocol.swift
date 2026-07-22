import Foundation

public enum BridgeProfile: UInt8, Sendable {
  case nemotron = 1
  case parakeet = 2
}

public enum BridgeOperation: UInt8, Sendable {
  case transcribe = 1
  case ping = 2
  case shutdown = 3
}

public struct BridgeRequest: Sendable {
  static let magic = Array("TRXQ".utf8)
  static let version: UInt16 = 1
  static let headerSize = 20
  static let maxSamples = 8 * 1_024 * 1_024
  static let maxLanguageBytes = 64

  public let operation: BridgeOperation
  public let profile: BridgeProfile
  public let sampleRate: UInt32
  public let language: String
  public let samples: [Float]

  public static func read(from input: FileHandle) throws -> BridgeRequest? {
    guard let header = try input.readExactly(headerSize) else { return nil }
    guard header.count == headerSize else {
      throw BridgeProtocolError.truncatedFrame
    }
    guard Array(header[0..<4]) == magic else {
      throw BridgeProtocolError.invalidMagic
    }
    guard header.uint16LE(at: 4) == version else {
      throw BridgeProtocolError.unsupportedVersion
    }
    guard let operation = BridgeOperation(rawValue: header[6]) else {
      throw BridgeProtocolError.invalidOperation
    }
    guard let profile = BridgeProfile(rawValue: header[7]) else {
      throw BridgeProtocolError.invalidProfile
    }

    let sampleRate = header.uint32LE(at: 8)
    let languageLength = Int(header.uint16LE(at: 12))
    let reserved = header.uint16LE(at: 14)
    let sampleCount = Int(header.uint32LE(at: 16))
    guard reserved == 0 else { throw BridgeProtocolError.invalidHeader }
    guard languageLength <= maxLanguageBytes else {
      throw BridgeProtocolError.languageTooLong
    }
    guard sampleCount <= maxSamples else {
      throw BridgeProtocolError.audioTooLarge
    }
    if operation == .transcribe, sampleCount == 0 {
      throw BridgeProtocolError.invalidAudio
    }
    if operation == .transcribe, !(8_000...96_000).contains(sampleRate) {
      throw BridgeProtocolError.invalidSampleRate
    }

    let languageData = try input.readExactly(languageLength) ?? Data()
    guard languageData.count == languageLength,
      let language = String(data: languageData, encoding: .utf8)
    else {
      throw BridgeProtocolError.invalidLanguage
    }
    guard
      language.utf8.allSatisfy({ byte in
        (48...57).contains(byte)
          || (65...90).contains(byte)
          || (97...122).contains(byte)
          || byte == 45
          || byte == 95
      })
    else {
      throw BridgeProtocolError.invalidLanguage
    }

    let sampleBytes = sampleCount.multipliedReportingOverflow(by: 4)
    guard !sampleBytes.overflow else { throw BridgeProtocolError.audioTooLarge }
    let audio = try input.readExactly(sampleBytes.partialValue) ?? Data()
    guard audio.count == sampleBytes.partialValue else {
      throw BridgeProtocolError.truncatedFrame
    }
    var samples = [Float]()
    samples.reserveCapacity(sampleCount)
    for offset in stride(from: 0, to: audio.count, by: 4) {
      let value = Float(bitPattern: audio.uint32LE(at: offset))
      guard value.isFinite else { throw BridgeProtocolError.invalidAudio }
      samples.append(value)
    }
    return BridgeRequest(
      operation: operation,
      profile: profile,
      sampleRate: sampleRate,
      language: language,
      samples: samples
    )
  }
}

public enum BridgeResponse {
  static let magic = Array("TRXP".utf8)
  static let version: UInt16 = 1
  static let maxBodyBytes = 1_024 * 1_024

  public static func write(
    to output: FileHandle,
    profile: BridgeProfile,
    result: Result<String, Error>
  ) throws {
    let status: UInt8
    let text: String
    switch result {
    case .success(let value):
      status = 0
      text = value
    case .failure(let error):
      status = 1
      text = String(describing: error)
    }
    let body = boundedBody(text)
    var frame = Data()
    frame.append(contentsOf: magic)
    frame.appendUInt16LE(version)
    frame.append(status)
    frame.append(profile.rawValue)
    frame.appendUInt32LE(UInt32(body.count))
    frame.append(body)
    try output.write(contentsOf: frame)
  }

  static func boundedBody(_ text: String) -> Data {
    var body = Data(text.utf8.prefix(maxBodyBytes))
    while String(data: body, encoding: .utf8) == nil {
      body.removeLast()
    }
    return body
  }
}

enum BridgeProtocolError: Error, Equatable {
  case invalidMagic
  case unsupportedVersion
  case invalidOperation
  case invalidProfile
  case invalidHeader
  case invalidSampleRate
  case languageTooLong
  case invalidLanguage
  case audioTooLarge
  case invalidAudio
  case truncatedFrame
}

extension FileHandle {
  func readExactly(_ count: Int) throws -> Data? {
    if count == 0 { return Data() }
    var data = Data()
    data.reserveCapacity(count)
    while data.count < count {
      guard let chunk = try read(upToCount: count - data.count), !chunk.isEmpty else {
        return data.isEmpty ? nil : data
      }
      data.append(chunk)
    }
    return data
  }
}

extension Data {
  func uint16LE(at offset: Int) -> UInt16 {
    UInt16(self[offset]) | UInt16(self[offset + 1]) << 8
  }

  func uint32LE(at offset: Int) -> UInt32 {
    UInt32(self[offset])
      | UInt32(self[offset + 1]) << 8
      | UInt32(self[offset + 2]) << 16
      | UInt32(self[offset + 3]) << 24
  }

  mutating func appendUInt16LE(_ value: UInt16) {
    append(UInt8(truncatingIfNeeded: value))
    append(UInt8(truncatingIfNeeded: value >> 8))
  }

  mutating func appendUInt32LE(_ value: UInt32) {
    append(UInt8(truncatingIfNeeded: value))
    append(UInt8(truncatingIfNeeded: value >> 8))
    append(UInt8(truncatingIfNeeded: value >> 16))
    append(UInt8(truncatingIfNeeded: value >> 24))
  }
}
