import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPasteShortcut,
  pasteTargetDir,
  pasteClipboardFiles,
} from "@/modules/explorer/lib/clipboardPaste";

const { invoke, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: { message: vi.fn(), error: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => vi.resetAllMocks());

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

  it.each([
    ["C:/a.txt", "C:/"],
    ["C:/repo/a.txt", "C:/repo"],
    ["/a.txt", "/"],
    ["//server/share/a.txt", "//server/share"],
  ])("preserves absolute roots for %s", (path, parent) => {
    expect(pasteTargetDir(path, () => false, parent)).toBe(parent);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function options() {
  return {
    root: "/repo",
    workspace: { kind: "wsl" as const, distro: "Ubuntu" },
    isCurrent: vi.fn(() => true),
    refresh: vi.fn(async (_path: string) => true),
  };
}

describe("pasteClipboardFiles", () => {
  it("keeps the captured root and environment across clipboard IPC", async () => {
    const clipboard = deferred<string[]>();
    invoke
      .mockReturnValueOnce(clipboard.promise)
      .mockResolvedValueOnce({ created: ["/repo/a"], failed: [] });
    const opts = options();
    const paste = pasteClipboardFiles("/repo", opts);
    opts.workspace = { kind: "wsl", distro: "Debian" };
    clipboard.resolve(["C:/a"]);
    expect(await paste).toEqual(["/repo/a"]);
    expect(invoke).toHaveBeenLastCalledWith("fs_copy", {
      sources: ["C:/a"],
      destDir: "/repo",
      root: "/repo",
      workspace: { kind: "wsl", distro: "Ubuntu" },
      renameOnConflict: true,
    });
  });

  it("cancels before copying when the workspace changed during clipboard IPC", async () => {
    const clipboard = deferred<string[]>();
    invoke.mockReturnValueOnce(clipboard.promise);
    const opts = options();
    const paste = pasteClipboardFiles("/repo", opts);
    opts.isCurrent.mockReturnValue(false);
    clipboard.resolve(["C:/a"]);
    expect(await paste).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(opts.refresh).not.toHaveBeenCalled();
  });

  it("does not return a selection until the refreshed tree has loaded", async () => {
    const read = deferred<boolean>();
    invoke
      .mockResolvedValueOnce(["C:/a"])
      .mockResolvedValueOnce({ created: ["/repo/a"], failed: [] });
    const opts = options();
    opts.refresh.mockReturnValue(read.promise);
    const selected = vi.fn();
    const paste = pasteClipboardFiles("/repo", opts).then(selected);
    await vi.waitFor(() => expect(opts.refresh).toHaveBeenCalledWith("/repo"));
    expect(selected).not.toHaveBeenCalled();
    read.resolve(true);
    await paste;
    expect(selected).toHaveBeenCalledWith(["/repo/a"]);
  });

  it("ignores copy completion in a different workspace", async () => {
    const copy = deferred<{ created: string[]; failed: [] }>();
    invoke.mockResolvedValueOnce(["C:/a"]).mockReturnValueOnce(copy.promise);
    const opts = options();
    const paste = pasteClipboardFiles("/repo", opts);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    opts.isCurrent.mockReturnValue(false);
    copy.resolve({ created: ["/repo/a"], failed: [] });
    expect(await paste).toEqual([]);
    expect(opts.refresh).not.toHaveBeenCalled();
  });

  it("does not select after switching workspace during refresh", async () => {
    const read = deferred<boolean>();
    invoke
      .mockResolvedValueOnce(["C:/a"])
      .mockResolvedValueOnce({ created: ["/repo/a"], failed: [] });
    const opts = options();
    opts.refresh.mockReturnValue(read.promise);
    const paste = pasteClipboardFiles("/repo", opts);
    await vi.waitFor(() => expect(opts.refresh).toHaveBeenCalledOnce());
    opts.isCurrent.mockReturnValue(false);
    read.resolve(true);
    expect(await paste).toEqual([]);
  });

  it("refreshes and returns successful items from a partially failed batch", async () => {
    invoke.mockResolvedValueOnce(["C:/a", "C:/missing"]).mockResolvedValueOnce({
      created: ["/repo/a"],
      failed: [{ source: "C:/missing", message: "not found" }],
    });
    const opts = options();
    expect(await pasteClipboardFiles("/repo", opts)).toEqual(["/repo/a"]);
    expect(opts.refresh).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith("Could not copy 1 item", {
      description: "C:/missing: not found",
    });
  });

  it("refreshes after a failed copy command", async () => {
    invoke.mockResolvedValueOnce(["C:/a"]).mockRejectedValueOnce("copy failed");
    const opts = options();
    expect(await pasteClipboardFiles("/repo", opts)).toEqual([]);
    expect(opts.refresh).toHaveBeenCalledWith("/repo");
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("distinguishes a busy clipboard from an empty clipboard", async () => {
    invoke.mockRejectedValueOnce("clipboard is busy");
    const opts = options();
    expect(await pasteClipboardFiles("/repo", opts)).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("Paste failed: clipboard is busy");
    expect(toast.message).not.toHaveBeenCalled();
    expect(opts.refresh).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce([]);
    await pasteClipboardFiles("/repo", opts);
    expect(toast.message).toHaveBeenCalledWith("No files on the clipboard");
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
