import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard, relativePath } from "./contextActions";

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

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it("copies raw paths for pasting into any application", async () => {
  const writeText = vi.fn();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const path = "/work/it's a $file.txt";
  await copyToClipboard(path);
  await copyToClipboard(relativePath("/work", path));
  expect(writeText.mock.calls).toEqual([[path], ["it's a $file.txt"]]);
});
