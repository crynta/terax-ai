import { describe, expect, it } from "vitest";
import {
  STT_TIMEOUT_CEIL_MS,
  STT_TIMEOUT_FLOOR_MS,
  STT_TIMEOUT_MS_PER_MB,
  sttTimeoutMs,
} from "./stt";

const MB = 1024 * 1024;

describe("sttTimeoutMs", () => {
  it("keeps the floor for a short clip", () => {
    expect(sttTimeoutMs(0)).toBe(STT_TIMEOUT_FLOOR_MS);
    expect(sttTimeoutMs(64 * 1024)).toBe(STT_TIMEOUT_FLOOR_MS);
  });

  it("scales with the recording once it outgrows the floor", () => {
    expect(sttTimeoutMs(2 * MB)).toBe(2 * STT_TIMEOUT_MS_PER_MB);
  });

  it("gives a five minute opus dictation more than the old fixed budget", () => {
    expect(sttTimeoutMs(Math.round(0.9 * MB))).toBeGreaterThan(30_000);
  });

  it("clamps to the ceiling", () => {
    expect(sttTimeoutMs(500 * MB)).toBe(STT_TIMEOUT_CEIL_MS);
  });

  it("treats a negative size as empty", () => {
    expect(sttTimeoutMs(-1)).toBe(STT_TIMEOUT_FLOOR_MS);
  });

  it("honours explicit bounds", () => {
    expect(sttTimeoutMs(10 * MB, 1_000, 5_000, 1_000)).toBe(5_000);
    expect(sttTimeoutMs(0, 1_000, 5_000, 1_000)).toBe(1_000);
  });
});
