import { describe, expect, it } from "vitest";
import { coalesceReasoningParts } from "./coalesceReasoning";

describe("coalesceReasoningParts", () => {
  it("returns the same parts when there is no reasoning", () => {
    const parts = [
      { type: "text", text: "hello" },
      { type: "tool-read_file", state: "output-available" },
    ];
    expect(coalesceReasoningParts(parts)).toBe(parts);
  });

  it("leaves a single leading reasoning part untouched", () => {
    const parts = [
      { type: "reasoning", text: "think", state: "done" },
      { type: "text", text: "answer" },
    ];
    expect(coalesceReasoningParts(parts)).toBe(parts);
  });

  it("merges interleaved reasoning into one block before content", () => {
    const parts = [
      { type: "reasoning", text: "step 1", state: "done" },
      { type: "text", text: "partial" },
      { type: "reasoning", text: "step 2", state: "done" },
      { type: "text", text: " final" },
      { type: "reasoning", text: "afterthought", state: "done" },
    ];
    expect(coalesceReasoningParts(parts)).toEqual([
      {
        type: "reasoning",
        text: "step 1\n\nstep 2\n\nafterthought",
        state: "done",
      },
      { type: "text", text: "partial" },
      { type: "text", text: " final" },
    ]);
  });

  it("hoists trailing-only reasoning before the answer", () => {
    const parts = [
      { type: "text", text: "answer first" },
      { type: "reasoning", text: "leaked think", state: "done" },
      { type: "reasoning", text: "more leak", state: "done" },
    ];
    expect(coalesceReasoningParts(parts)).toEqual([
      {
        type: "reasoning",
        text: "leaked think\n\nmore leak",
        state: "done",
      },
      { type: "text", text: "answer first" },
    ]);
  });

  it("marks the merged part streaming if any fragment is streaming", () => {
    const parts = [
      { type: "reasoning", text: "a", state: "done" },
      { type: "text", text: "x" },
      { type: "reasoning", text: "b", state: "streaming" },
    ];
    const out = coalesceReasoningParts(parts);
    expect(out[0]).toMatchObject({
      type: "reasoning",
      text: "a\n\nb",
      state: "streaming",
    });
  });

  it("drops empty reasoning-only noise", () => {
    const parts = [
      { type: "reasoning", text: "", state: "done" },
      { type: "text", text: "only answer" },
      { type: "reasoning", text: "" },
    ];
    expect(coalesceReasoningParts(parts)).toEqual([
      { type: "text", text: "only answer" },
    ]);
  });

  it("preserves non-reasoning parts and tool order", () => {
    const parts = [
      { type: "reasoning", text: "r1" },
      { type: "tool-bash_run", state: "output-available" },
      { type: "reasoning", text: "r2" },
      { type: "text", text: "done" },
    ];
    expect(coalesceReasoningParts(parts)).toEqual([
      { type: "reasoning", text: "r1\n\nr2" },
      { type: "tool-bash_run", state: "output-available" },
      { type: "text", text: "done" },
    ]);
  });
});
