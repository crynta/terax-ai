import { describe, expect, it, vi } from "vitest";
import { parseOsc7, parseOsc52Clipboard } from "./osc-handlers";
import { GhosttySemanticEventRouter } from "@/modules/terminal/ghostty/core/GhosttySemanticEventRouter";
vi.mock("@/lib/platform", () => ({ IS_WINDOWS: true }));

describe("terminal semantic boundaries", () => {
  it.each([
    ["file:///c/Users/leo/project", "C:/Users/leo/project"],
    ["file:///C:/Users/me/project", "C:/Users/me/project"],
    ["file://host/home/me/a%20b", "/home/me/a b"],
    // cmd.exe prompts: raw backslashes, spaces and characters a URL would escape.
    ["file://BOX/C:\\Users\\me\\proj", "C:/Users/me/proj"],
    ["file:///D:\\My Docs\\100% real #1", "D:/My Docs/100% real #1"],
    // a literal percent in a cmd.exe folder name is not an escape
    ["file://BOX/C:\\Users\\a%20b\\c%2Fd", "C:/Users/a%20b/c%2Fd"],
    ["file://BOX/C:\\", "C:/"],
    ["file://BOX/\\\\server\\share\\dir", "//server/share/dir"],
    // while the encoded form every other shell sends still decodes
    ["file:///C:/Users/a%20b", "C:/Users/a b"],
    ["https://example.com/path", null],
  ])("normalizes cwd %s", (uri, expected) =>
    expect(parseOsc7(uri)).toBe(expected),
  );

  it("rejects cwd during command input and output, then accepts the local prompt", () => {
    const onCwd = vi.fn();
    const router = new GhosttySemanticEventRouter({ onCwd });
    router.handle({ type: "prompt-start" });
    router.handle({ type: "pwd", uri: "file:///home/me" });
    router.handle({ type: "prompt-end" });
    router.handle({ type: "pwd", uri: "file:///etc" });
    router.handle({ type: "end-of-input" });
    router.handle({ type: "pwd", uri: "file:///private" });
    router.handle({ type: "end-of-command", exitCode: 0 });
    router.handle({ type: "pwd", uri: "file:///home/me/project" });
    expect(onCwd.mock.calls).toEqual([["/home/me"], ["/home/me/project"]]);
  });

  it.each([
    ["c;SGVsbG8=", "Hello"],
    ["c;zrsg5pel5pys6Kqe", "λ 日本語"],
    ["p;SGVsbG8=", null],
    ["c;?", null],
    ["c;bad base64!", null],
    ["c;/w==", null],
  ])("validates clipboard payload %s", (payload, expected) =>
    expect(parseOsc52Clipboard(payload)).toBe(expected),
  );

  it("rejects oversized clipboard writes", () =>
    expect(parseOsc52Clipboard(`c;${"A".repeat(1_398_110)}`)).toBeNull());
});
