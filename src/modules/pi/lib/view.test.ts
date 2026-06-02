import { describe, expect, it } from "vitest";
import { buildPiContextPreview, pathBasename } from "@/modules/pi/lib/view";

describe("pathBasename", () => {
  it("handles unix, windows, and trailing separators", () => {
    expect(pathBasename("/Users/me/projects/terax-pi/")).toBe("terax-pi");
    expect(pathBasename("C:\\Users\\me\\Projects\\terax-pi\\src")).toBe("src");
    expect(pathBasename(null)).toBeNull();
  });
});

describe("buildPiContextPreview", () => {
  it("uses compact relative labels for paths inside the workspace", () => {
    expect(
      buildPiContextPreview(
        {
          workspaceRoot: "/Users/me/Projects/terax-pi",
          activeTerminalCwd: "/Users/me/Projects/terax-pi/src-tauri",
          activeFile: "/Users/me/Projects/terax-pi/src/modules/pi/PiPanel.tsx",
          activeTerminalPrivate: true,
        },
        null,
      ),
    ).toEqual([
      expect.objectContaining({ key: "workspace", value: "terax-pi" }),
      expect.objectContaining({ key: "terminal", value: "src-tauri" }),
      expect.objectContaining({
        key: "file",
        value: "src/modules/pi/PiPanel.tsx",
      }),
      expect.objectContaining({
        key: "mode",
        value: "Private",
        tone: "private",
      }),
    ]);
  });

  it("falls back to the session cwd when no workspace root is supplied", () => {
    expect(
      buildPiContextPreview(
        {
          activeTerminalCwd: null,
          activeFile: null,
          activeTerminalPrivate: false,
        },
        "/tmp/project",
      ),
    ).toEqual([
      expect.objectContaining({ key: "workspace", value: "project" }),
      expect.objectContaining({
        key: "terminal",
        value: "No terminal",
        missing: true,
      }),
      expect.objectContaining({ key: "file", value: "No file", missing: true }),
      expect.objectContaining({
        key: "mode",
        value: "Standard",
        tone: "muted",
      }),
    ]);
  });
});
