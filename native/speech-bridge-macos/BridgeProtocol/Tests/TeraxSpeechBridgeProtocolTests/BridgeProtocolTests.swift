import Foundation
import XCTest

@testable import TeraxSpeechBridgeProtocol

final class BridgeProtocolTests: XCTestCase {
  func testRequestDecodesLittleEndianSamples() throws {
    var frame = Data("TRXQ".utf8)
    frame.appendUInt16LE(1)
    frame.append(BridgeOperation.transcribe.rawValue)
    frame.append(BridgeProfile.nemotron.rawValue)
    frame.appendUInt32LE(16_000)
    frame.appendUInt16LE(5)
    frame.appendUInt16LE(0)
    frame.appendUInt32LE(2)
    frame.append(Data("en-US".utf8))
    frame.appendUInt32LE(Float(0.25).bitPattern)
    frame.appendUInt32LE(Float(-0.5).bitPattern)

    let input = Pipe()
    try input.fileHandleForWriting.write(contentsOf: frame)
    try input.fileHandleForWriting.close()
    let request = try BridgeRequest.read(from: input.fileHandleForReading)

    XCTAssertEqual(request?.operation, .transcribe)
    XCTAssertEqual(request?.profile, .nemotron)
    XCTAssertEqual(request?.sampleRate, 16_000)
    XCTAssertEqual(request?.language, "en-US")
    XCTAssertEqual(request?.samples, [0.25, -0.5])
  }

  func testRequestRejectsNonFiniteAudio() throws {
    var frame = Data("TRXQ".utf8)
    frame.appendUInt16LE(1)
    frame.append(BridgeOperation.transcribe.rawValue)
    frame.append(BridgeProfile.parakeet.rawValue)
    frame.appendUInt32LE(16_000)
    frame.appendUInt16LE(0)
    frame.appendUInt16LE(0)
    frame.appendUInt32LE(1)
    frame.appendUInt32LE(Float.nan.bitPattern)

    let input = Pipe()
    try input.fileHandleForWriting.write(contentsOf: frame)
    try input.fileHandleForWriting.close()

    XCTAssertThrowsError(try BridgeRequest.read(from: input.fileHandleForReading)) {
      XCTAssertEqual($0 as? BridgeProtocolError, .invalidAudio)
    }
  }

  func testRequestRejectsTruncatedHeaderWithoutIndexingPastData() throws {
    let input = Pipe()
    try input.fileHandleForWriting.write(contentsOf: Data("TRXQ".utf8))
    try input.fileHandleForWriting.close()

    XCTAssertThrowsError(try BridgeRequest.read(from: input.fileHandleForReading)) {
      XCTAssertEqual($0 as? BridgeProtocolError, .truncatedFrame)
    }
  }

  func testResponseHasBoundedFraming() throws {
    let output = Pipe()
    try BridgeResponse.write(
      to: output.fileHandleForWriting,
      profile: .parakeet,
      result: .success("hello")
    )
    try output.fileHandleForWriting.close()
    let data = output.fileHandleForReading.readDataToEndOfFile()

    XCTAssertEqual(String(decoding: data[0..<4], as: UTF8.self), "TRXP")
    XCTAssertEqual(data.uint16LE(at: 4), 1)
    XCTAssertEqual(data[6], 0)
    XCTAssertEqual(data[7], BridgeProfile.parakeet.rawValue)
    XCTAssertEqual(data.uint32LE(at: 8), 5)
    XCTAssertEqual(String(decoding: data[12...], as: UTF8.self), "hello")
  }

  func testResponseDoesNotSplitUTF8AtSizeLimit() {
    let text = String(repeating: "a", count: BridgeResponse.maxBodyBytes - 1) + "é"
    let body = BridgeResponse.boundedBody(text)

    XCTAssertEqual(body.count, BridgeResponse.maxBodyBytes - 1)
    XCTAssertNotNil(String(data: body, encoding: .utf8))
  }
}
