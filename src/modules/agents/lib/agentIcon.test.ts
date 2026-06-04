import { describe, expect, it } from "vitest";
import { agentIconKind } from "./agentIcon";

describe("agentIconKind", () => {
  it("recognizes first class provider identities", () => {
    expect(agentIconKind("Terax AI")).toBe("terax");
    expect(agentIconKind("Claude Code")).toBe("claude");
    expect(agentIconKind("Codex")).toBe("codex");
    expect(agentIconKind("Pi")).toBe("pi");
    expect(agentIconKind("Cursor Agent")).toBe("cursor");
    expect(agentIconKind("OpenCode")).toBe("opencode");
    expect(agentIconKind("Gemini CLI")).toBe("gemini");
    expect(agentIconKind("agy")).toBe("antigravity");
  });
});
