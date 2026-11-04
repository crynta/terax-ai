import { afterEach, describe, expect, it, vi } from "vitest";

const { invoke, openUrl } = vi.hoisted(() => ({
  invoke: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: () => Promise.resolve("/Users/me"),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import {
  openTerminalLink,
  parseTerminalFileLink,
  setTerminalFileOpener,
} from "./terminalFileLinks";

describe("parseTerminalFileLink", () => {
  it("resolves printed paths against the cwd and home", () => {
    expect(parseTerminalFileLink("src/a.ts:12:3", "/repo", null)).toEqual({
      path: "/repo/src/a.ts",
      line: 12,
    });
    expect(parseTerminalFileLink("../b/c.md", "/repo/x", null)).toEqual({
      path: "/repo/b/c.md",
    });
    expect(parseTerminalFileLink("~/notes/x.md", null, "/Users/me")).toEqual({
      path: "/Users/me/notes/x.md",
    });
    expect(parseTerminalFileLink("/etc/hosts:3", null, null)).toEqual({
      path: "/etc/hosts",
      line: 3,
    });
  });

  it("decodes file URIs and their line fragments", () => {
    expect(
      parseTerminalFileLink("file:///Users/me/My%20App/a.ts#L7", null, null),
    ).toEqual({ path: "/Users/me/My App/a.ts", line: 7 });
    expect(parseTerminalFileLink("file://host/tmp/a.ts:4", null, null)).toEqual(
      { path: "/tmp/a.ts", line: 4 },
    );
  });

  it("refuses other schemes and paths without a base", () => {
    expect(parseTerminalFileLink("https://example.com/a.ts", "/r", null)).toBe(
      null,
    );
    expect(parseTerminalFileLink("src/a.ts", null, null)).toBe(null);
    expect(parseTerminalFileLink("~/a.md", "/r", null)).toBe(null);
  });
});

describe("openTerminalLink", () => {
  afterEach(() => {
    vi.clearAllMocks();
    setTerminalFileOpener(null);
  });

  it("opens existing files in the editor without refocusing the terminal", async () => {
    const open = vi.fn();
    const settled = vi.fn();
    setTerminalFileOpener(open);
    invoke.mockResolvedValue({ kind: "file" });
    await openTerminalLink("src/a.ts:9", "/repo", settled);
    expect(invoke).toHaveBeenCalledWith(
      "fs_stat",
      expect.objectContaining({ path: "/repo/src/a.ts" }),
    );
    expect(open).toHaveBeenCalledWith("/repo/src/a.ts", 9);
    expect(settled).not.toHaveBeenCalled();
  });

  it("returns focus when the path is missing or a directory", async () => {
    const open = vi.fn();
    const settled = vi.fn();
    setTerminalFileOpener(open);
    invoke.mockRejectedValueOnce(new Error("missing"));
    await openTerminalLink("src/a.ts", "/repo", settled);
    invoke.mockResolvedValueOnce({ kind: "dir" });
    await openTerminalLink("/repo/src", "/repo", settled);
    expect(open).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledTimes(2);
  });

  it("keeps web links in the browser", async () => {
    openUrl.mockResolvedValue(undefined);
    await openTerminalLink("https://example.com/a.ts", "/repo");
    expect(openUrl).toHaveBeenCalledWith("https://example.com/a.ts");
    expect(invoke).not.toHaveBeenCalled();
  });
});
