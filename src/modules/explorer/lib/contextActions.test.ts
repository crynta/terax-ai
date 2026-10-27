import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyPathToClipboard,
  escapeForShell,
  relativePath,
} from "./contextActions";

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

describe("relativePath", () => {
  it("returns '.' when the path is the root itself", () => {
    expect(relativePath("/a/b", "/a/b")).toBe(".");
  });

  it("strips the root prefix for a descendant path", () => {
    expect(relativePath("/a/b", "/a/b/c/d")).toBe("c/d");
  });

  it("does not relativize a sibling that only shares the root prefix", () => {
    expect(relativePath("/a/b", "/a/bc/d")).toBe("/a/bc/d");
  });

  it("returns an unrelated path unchanged", () => {
    expect(relativePath("/a/b", "/x/y")).toBe("/x/y");
  });
});

describe("escapeForShell", () => {
  it("leaves plain paths untouched", () => {
    expect(escapeForShell("/a/b/c.ts", false)).toBe("/a/b/c.ts");
  });

  it("escapes spaces so the path stays one argument", () => {
    expect(escapeForShell("/a/My Folder/c.ts", false)).toBe(
      "/a/My\\ Folder/c.ts",
    );
  });

  it("escapes shell syntax inside names", () => {
    expect(escapeForShell("/a/b $HOME & c", false)).toBe(
      "/a/b\\ \\$HOME\\ \\&\\ c",
    );
    expect(escapeForShell("/a/[draft] *", false)).toBe("/a/\\[draft\\]\\ \\*");
  });

  it("escapes a literal backslash so it is not read as an escape", () => {
    expect(escapeForShell("/a/b\\ c", false)).toBe("/a/b\\\\\\ c");
  });

  it("quotes instead of escaping on Windows, where backslash is a separator", () => {
    expect(escapeForShell("C:\\a\\My Folder\\c.ts", true)).toBe(
      '"C:\\a\\My Folder\\c.ts"',
    );
    expect(escapeForShell("C:\\a\\c.ts", true)).toBe("C:\\a\\c.ts");
  });

  it("keeps empty input empty", () => {
    expect(escapeForShell("", false)).toBe("");
  });
});

describe("copyPathToClipboard", () => {
  it("writes the shell-safe path to the clipboard", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyPathToClipboard(
      relativePath("/repo", "/repo/My Folder/notes.txt"),
    );

    expect(writeText).toHaveBeenCalledWith("My\\ Folder/notes.txt");
  });
});
