import { describe, expect, it } from "vitest";
import { isOpencodeBaseURL, opencodeSessionHeaders } from "./opencodeSession";

describe("isOpencodeBaseURL", () => {
  it("matches opencode.ai and its subdomains", () => {
    expect(isOpencodeBaseURL("https://opencode.ai/zen/v1")).toBe(true);
    expect(isOpencodeBaseURL("https://api.opencode.ai/v1")).toBe(true);
    expect(isOpencodeBaseURL("HTTPS://OPENCODE.AI/zen/v1/")).toBe(true);
  });

  it("ignores other hosts and look-alikes", () => {
    expect(isOpencodeBaseURL("https://api.openai.com/v1")).toBe(false);
    expect(isOpencodeBaseURL("https://notopencode.ai/v1")).toBe(false);
    expect(isOpencodeBaseURL("https://opencode.ai.example.com/v1")).toBe(false);
    expect(isOpencodeBaseURL("http://localhost:1234/v1")).toBe(false);
    expect(isOpencodeBaseURL("")).toBe(false);
    expect(isOpencodeBaseURL("not a url")).toBe(false);
  });
});

describe("opencodeSessionHeaders", () => {
  it("attaches a stable x-opencode-session for opencode.ai endpoints", () => {
    const first = opencodeSessionHeaders("https://opencode.ai/zen/v1");
    const second = opencodeSessionHeaders("https://opencode.ai/zen/v1");
    expect(first).toBeDefined();
    expect(first?.["x-opencode-session"]).toMatch(/^[0-9a-f]+$/);
    expect(second).toEqual(first);
  });

  it("uses the given session key verbatim", () => {
    expect(
      opencodeSessionHeaders("https://opencode.ai/zen/v1", "abc123"),
    ).toEqual({
      "x-opencode-session": "abc123",
    });
  });

  it("sends nothing to other endpoints", () => {
    expect(opencodeSessionHeaders("https://api.deepseek.com")).toBeUndefined();
    expect(opencodeSessionHeaders("http://localhost:11434/v1")).toBeUndefined();
  });
});
