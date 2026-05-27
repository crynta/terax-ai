import { describe, expect, it, vi } from "vitest";
import { blobToMonoPcm16k, downmixToMono, TARGET_SAMPLE_RATE } from "./audio";

describe("downmixToMono", () => {
  it("returns the single channel unchanged for mono input", () => {
    const ch = new Float32Array([0.1, 0.2, 0.3]);
    expect(downmixToMono([ch])).toEqual(ch);
  });

  it("averages channels for stereo input", () => {
    const l = new Float32Array([0.0, 0.5, 1.0]);
    const r = new Float32Array([1.0, 0.5, 0.0]);
    expect(Array.from(downmixToMono([l, r]))).toEqual([0.5, 0.5, 0.5]);
  });

  it("averages all three channels for surround input", () => {
    const a = new Float32Array([0, 3]);
    const b = new Float32Array([0, 3]);
    const c = new Float32Array([0, 3]);
    expect(Array.from(downmixToMono([a, b, c]))).toEqual([0, 3]);
  });
});

describe("blobToMonoPcm16k", () => {
  it("uses OfflineAudioContext at the target sample rate", async () => {
    const numFrames = 48_000;
    const stereoBuffer = {
      numberOfChannels: 1,
      length: numFrames,
      sampleRate: 48_000,
      duration: 1,
      getChannelData: () => new Float32Array(numFrames).fill(0.42),
    };
    const renderedFrames = 16_000;
    const renderedBuffer = {
      numberOfChannels: 1,
      length: renderedFrames,
      sampleRate: 16_000,
      duration: 1,
      getChannelData: () => new Float32Array(renderedFrames).fill(0.42),
    };
    const ctorCalls: Array<{ ch: number; len: number; rate: number }> = [];
    class FakeOfflineCtx {
      destination = {};
      constructor(ch: number, len: number, rate: number) {
        ctorCalls.push({ ch, len, rate });
      }
      createBufferSource() {
        return {
          buffer: null as null | unknown,
          connect: () => {},
          start: () => {},
        };
      }
      createBuffer(ch: number, len: number, rate: number) {
        return {
          numberOfChannels: ch,
          length: len,
          sampleRate: rate,
          copyToChannel: () => {},
        };
      }
      decodeAudioData() {
        return Promise.resolve(stereoBuffer);
      }
      startRendering() {
        return Promise.resolve(renderedBuffer);
      }
    }
    vi.stubGlobal("OfflineAudioContext", FakeOfflineCtx);

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const out = await blobToMonoPcm16k(blob);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(renderedFrames);
    expect(TARGET_SAMPLE_RATE).toBe(16_000);
    expect(ctorCalls[ctorCalls.length - 1].rate).toBe(16_000);
    expect(ctorCalls[ctorCalls.length - 1].ch).toBe(1);

    vi.unstubAllGlobals();
  });
});
