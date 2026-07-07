import { describe, expect, it } from "vitest";
import {
  areOpenClickyAiToolsEnabled,
  isTtsReadAloudEnabled,
  OPENCLICKY_AI_TOOLS_STORAGE_KEY,
  TTS_READ_ALOUD_STORAGE_KEY,
} from "./featureGates";

function storage(values: Record<string, string | null>) {
  return {
    getItem: (key: string) => values[key] ?? null,
  };
}

describe("experimental feature gates", () => {
  it("keeps openclicky-only AI tools disabled by default", () => {
    expect(areOpenClickyAiToolsEnabled(null)).toBe(false);
    expect(areOpenClickyAiToolsEnabled(storage({}))).toBe(false);
    expect(
      areOpenClickyAiToolsEnabled(
        storage({ [OPENCLICKY_AI_TOOLS_STORAGE_KEY]: "true" }),
      ),
    ).toBe(true);
  });

  it("keeps TTS read-aloud disabled by default", () => {
    expect(isTtsReadAloudEnabled(null)).toBe(false);
    expect(isTtsReadAloudEnabled(storage({}))).toBe(false);
    expect(
      isTtsReadAloudEnabled(storage({ [TTS_READ_ALOUD_STORAGE_KEY]: "on" })),
    ).toBe(true);
  });
});
