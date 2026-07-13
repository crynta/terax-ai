import { describe, expect, it } from "vitest";
import { assertLoopbackUrl, downmixChannels, encodeFloat32Le } from "./stt";

describe("local transcription URLs", () => {
  it.each([
    "http://localhost:8080",
    "http://127.0.0.1:8080/v1",
    "https://127.20.30.40:8443",
    "http://[::1]:8080",
  ])("accepts loopback URL %s", (url) => {
    expect(() => assertLoopbackUrl(url, "Local STT")).not.toThrow();
  });

  it.each([
    "http://192.168.1.4:8080",
    "http://0.0.0.0:8080",
    "https://example.com/v1",
    "ftp://localhost:8080",
    "http://user:pass@localhost:8080",
    "not a url",
  ])("rejects non-local or unsafe URL %s", (url) => {
    expect(() => assertLoopbackUrl(url, "Local STT")).toThrow();
  });
});

describe("native transcription PCM", () => {
  it("downmixes every channel instead of dropping stereo audio", () => {
    const mono = downmixChannels([
      new Float32Array([1, -1, 0.5]),
      new Float32Array([-1, 1, 0.5]),
    ]);
    expect(Array.from(mono)).toEqual([0, 0, 0.5]);
  });

  it("encodes Float32 samples as little-endian bytes", () => {
    const bytes = encodeFloat32Le(new Float32Array([1, -0.5]));
    expect(Array.from(bytes)).toEqual([0, 0, 128, 63, 0, 0, 0, 191]);
  });

  it("rejects malformed channel sets", () => {
    expect(() => downmixChannels([])).toThrow("no channels");
    expect(() =>
      downmixChannels([new Float32Array(1), new Float32Array(2)]),
    ).toThrow("different lengths");
  });
});
