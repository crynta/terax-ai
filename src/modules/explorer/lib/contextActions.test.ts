import { afterEach, describe, expect, it, vi } from "vitest";
import { copyPathToClipboard, relativePath } from "./contextActions";

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
