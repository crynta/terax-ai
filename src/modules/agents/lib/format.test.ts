import { describe, expect, it } from "vitest";
import { displayAgent } from "./format";

describe("displayAgent", () => {
  it("maps known agent ids to their display labels", () => {
    expect(displayAgent("claude")).toBe("Claude Code");
    expect(displayAgent("codex")).toBe("Codex");
    expect(displayAgent("pi")).toBe("Pi");
  });

  it("looks the label up case-insensitively", () => {
    expect(displayAgent("CLAUDE")).toBe("Claude Code");
    expect(displayAgent("gEmInI")).toBe("Gemini");
  });

  it("capitalizes an unknown agent id", () => {
    expect(displayAgent("foobar")).toBe("Foobar");
  });

  it("falls back to 'Agent' for an empty id", () => {
    expect(displayAgent("")).toBe("Agent");
  });
});
