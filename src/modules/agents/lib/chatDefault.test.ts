import { describe, expect, it } from "vitest";
import { shouldOpenInChat } from "./chatDefault";

describe("shouldOpenInChat", () => {
  it("opens a freshly started Claude session when the setting is on", () => {
    expect(shouldOpenInChat("claude", true, false)).toBe(true);
  });

  it("leaves other agents, repeat signals and a disabled setting alone", () => {
    expect(shouldOpenInChat("codex", true, false)).toBe(false);
    expect(shouldOpenInChat(null, true, false)).toBe(false);
    expect(shouldOpenInChat("claude", true, true)).toBe(false);
    expect(shouldOpenInChat("claude", false, false)).toBe(false);
  });
});
