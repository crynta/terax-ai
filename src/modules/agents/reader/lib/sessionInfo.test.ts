import { describe, expect, it } from "vitest";
import {
  contextWindowFor,
  formatTokens,
  modelLabel,
  sessionInfo,
} from "./sessionInfo";
import { buildDocument, type TranscriptEntry } from "./transcript";

const usage = (input: number, output: number, cacheRead = 0, cacheNew = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadInputTokens: cacheRead,
  cacheCreationInputTokens: cacheNew,
});

describe("modelLabel", () => {
  it("names current and older model ids", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelLabel("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(modelLabel("claude-fable-5-1")).toBe("Fable 5.1");
    expect(modelLabel("claude-opus-4-20250514")).toBe("Opus 4");
    expect(modelLabel("claude-3-5-sonnet-20241022")).toBe("Sonnet 3.5");
    expect(modelLabel("claude-opus-5-5[1m]")).toBe("Opus 5.5 (1M)");
    expect(modelLabel("gpt-5.4-mini")).toBe("gpt-5.4-mini");
  });

  it("gives 1M-context variants a 1M window and the rest 200k", () => {
    expect(contextWindowFor("claude-opus-5-5[1m]")).toBe(1_000_000);
    expect(contextWindowFor("claude-opus-5-5")).toBe(200_000);
    expect(contextWindowFor(null)).toBe(200_000);
  });
});

describe("sessionInfo", () => {
  const entries: TranscriptEntry[] = [
    {
      kind: "user",
      uuid: "u1",
      timestamp: "2026-11-04T10:00:00Z",
      blocks: [{ type: "text", text: "fix it" }],
    },
    {
      kind: "assistant",
      uuid: "a1",
      timestamp: "2026-11-04T10:00:05Z",
      model: "claude-opus-5-5",
      usage: usage(10, 200, 50_000, 1_000),
      blocks: [{ type: "text", text: "Looking" }],
    },
    {
      // The same reply's next block repeats its usage.
      kind: "assistant",
      uuid: "a2",
      timestamp: "2026-11-04T10:00:06Z",
      model: "claude-opus-5-5",
      usage: usage(10, 200, 50_000, 1_000),
      blocks: [
        {
          type: "toolUse",
          id: "t1",
          name: "Edit",
          input: { file_path: "/r/a.ts" },
        },
      ],
    },
    {
      kind: "user",
      uuid: "u2",
      timestamp: "2026-11-04T10:00:07Z",
      blocks: [
        { type: "toolResult", toolUseId: "t1", content: "ok", isError: false },
      ],
      toolUseResult: {
        filePath: "/r/a.ts",
        oldString: "a\nb\n",
        newString: "a\nc\nd\n",
      },
    },
    {
      kind: "assistant",
      uuid: "s1",
      isSidechain: true,
      timestamp: "2026-11-04T10:00:08Z",
      model: "claude-haiku-5-5",
      usage: usage(5, 9_999),
      blocks: [{ type: "text", text: "subagent" }],
    },
    {
      kind: "assistant",
      uuid: "a3",
      timestamp: "2026-11-04T10:01:00Z",
      model: "claude-opus-5-5",
      usage: usage(20, 300, 60_000, 0),
      blocks: [{ type: "text", text: "Done" }],
    },
  ];

  it("reports model, context, tokens, times and diff lines", () => {
    const doc = buildDocument(entries);
    const info = sessionInfo(entries, doc.turns);
    expect(info.model).toBe("Opus 5.5");
    expect(info.contextUsed).toBe(60_020);
    expect(info.contextWindow).toBe(200_000);
    expect(info.contextPercent).toBe(30);
    expect(info.outputTokens).toBe(500);
    expect(info.startedAt).toBe(Date.parse("2026-11-04T10:00:00Z"));
    expect(info.lastAt).toBe(Date.parse("2026-11-04T10:01:00Z"));
    expect(info.added).toBe(2);
    expect(info.removed).toBe(1);
  });

  it("has no context figure without usage data", () => {
    const info = sessionInfo([entries[0]], []);
    expect(info.model).toBeNull();
    expect(info.contextPercent).toBeNull();
    expect(info.outputTokens).toBe(0);
  });
});

describe("formatTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(4_520)).toBe("4.5k");
    expect(formatTokens(12_340)).toBe("12k");
    expect(formatTokens(1_250_000)).toBe("1.25M");
    expect(formatTokens(2_000_000)).toBe("2M");
  });
});
