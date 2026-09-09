import { describe, expect, it } from "vitest";
import {
  CLEANUP_MAX_CHARS,
  CLEANUP_MIN_RETENTION,
  CLEANUP_OUTPUT_TOKEN_CAP,
  cleanupOutputTokens,
  keepsFullTranscript,
  normalizeTranscript,
  shouldSkipCleanup,
} from "./cleanup";

describe("normalizeTranscript", () => {
  it("tightens punctuation spacing and collapses runs of spaces", () => {
    expect(normalizeTranscript("hola  mundo , y algo .")).toBe(
      "Hola mundo, y algo.",
    );
  });

  it("capitalizes the first character", () => {
    expect(normalizeTranscript("bueno")).toBe("Bueno");
  });

  it("leaves blank input blank", () => {
    expect(normalizeTranscript("   ")).toBe("");
  });
});

describe("keepsFullTranscript", () => {
  it("accepts ordinary filler removal", () => {
    const original = "Um, so I think we should, uh, ship the fix today.";
    const cleaned = "So I think we should ship the fix today.";
    expect(keepsFullTranscript(original, cleaned)).toBe(true);
  });

  it("rejects a fragment that would drop most of a long dictation", () => {
    const original = "a".repeat(4000);
    const cleaned = "the last two lines only";
    expect(keepsFullTranscript(original, cleaned)).toBe(false);
  });

  it("rejects an empty or whitespace-only response", () => {
    expect(keepsFullTranscript("some real transcript", "")).toBe(false);
    expect(keepsFullTranscript("some real transcript", "   \n ")).toBe(false);
  });

  it("accepts output that grows, as punctuation repair can", () => {
    expect(keepsFullTranscript("hola mundo", "Hola, mundo.")).toBe(true);
  });

  it("uses the retention ratio as the boundary", () => {
    const original = "x".repeat(100);
    const atLimit = "y".repeat(Math.floor(100 * CLEANUP_MIN_RETENTION));
    expect(keepsFullTranscript(original, atLimit)).toBe(true);
    expect(keepsFullTranscript(original, atLimit.slice(1))).toBe(false);
  });

  it("honours an explicit retention override", () => {
    const original = "x".repeat(100);
    expect(keepsFullTranscript(original, "y".repeat(30), 0.2)).toBe(true);
    expect(keepsFullTranscript(original, "y".repeat(10), 0.2)).toBe(false);
  });
});

describe("shouldSkipCleanup", () => {
  it("passes an ordinary dictation through the model", () => {
    expect(shouldSkipCleanup("x".repeat(CLEANUP_MAX_CHARS))).toBe(false);
  });

  it("skips the model call once the transcript is long", () => {
    expect(shouldSkipCleanup("x".repeat(CLEANUP_MAX_CHARS + 1))).toBe(true);
  });
});

describe("cleanupOutputTokens", () => {
  it("scales with the transcript so the reply cannot be cut short", () => {
    expect(cleanupOutputTokens("x".repeat(300))).toBe(356);
    expect(cleanupOutputTokens("x".repeat(30))).toBe(266);
  });

  it("never exceeds the cap", () => {
    expect(cleanupOutputTokens("x".repeat(1_000_000))).toBe(
      CLEANUP_OUTPUT_TOKEN_CAP,
    );
  });
});
