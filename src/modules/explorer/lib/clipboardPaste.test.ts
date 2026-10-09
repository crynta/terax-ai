import { describe, expect, it } from "vitest";
import { isPasteShortcut, pasteTargetDir } from "./clipboardPaste";

const dirs = new Set(["/r/src", "/r/src/lib"]);
const isDir = (p: string) => dirs.has(p);

describe("pasteTargetDir", () => {
  it("pastes at the root when nothing is selected", () => {
    expect(pasteTargetDir(null, isDir, "/r")).toBe("/r");
  });

  it("pastes inside a selected folder", () => {
    expect(pasteTargetDir("/r/src/lib", isDir, "/r")).toBe("/r/src/lib");
  });

  it("pastes beside a selected file", () => {
    expect(pasteTargetDir("/r/src/a.ts", isDir, "/r")).toBe("/r/src");
  });
});

describe("isPasteShortcut", () => {
  const key = (k: Partial<KeyboardEvent>) => ({
    key: "v",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...k,
  });

  it("uses Cmd on macOS and Ctrl elsewhere", () => {
    expect(isPasteShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isPasteShortcut(key({ ctrlKey: true }), true)).toBe(false);
    expect(isPasteShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isPasteShortcut(key({ metaKey: true }), false)).toBe(false);
  });

  it("ignores other keys and extra modifiers", () => {
    expect(isPasteShortcut(key({ key: "c", metaKey: true }), true)).toBe(false);
    expect(isPasteShortcut(key({ metaKey: true, shiftKey: true }), true)).toBe(
      false,
    );
    expect(isPasteShortcut(key({ key: "V", metaKey: true }), true)).toBe(true);
  });
});
