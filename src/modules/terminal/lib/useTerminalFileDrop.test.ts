import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(), ptyId: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("./terminalSessionApi", () => ({ ptyIdForLeaf: native.ptyId, pasteIntoSession: vi.fn() }));
beforeEach(() => {
  native.invoke.mockReset().mockResolvedValue("/bin/bash");
  native.ptyId.mockReset().mockReturnValue(9);
});

vi.mock("@/lib/platform", () => ({ IS_WINDOWS: false }));

import { createTerminalPathDropTarget } from "./useTerminalFileDrop";

describe("createTerminalPathDropTarget", () => {
  it("tracks the terminal leaf under the pointer", () => {
    const setTarget = vi.fn();
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: (x, y) => (x === 20 && y === 30 ? 7 : null),
      paste: vi.fn(),
      setTarget,
    });

    expect(target.updateTarget(20, 30)).toBe(true);
    expect(setTarget).toHaveBeenLastCalledWith(7);
    expect(target.updateTarget(1, 2)).toBe(false);
    expect(setTarget).toHaveBeenLastCalledWith(null);
  });

  it("clears the target and pastes a shell-quoted path", async () => {
    const paste = vi.fn(() => true);
    const setTarget = vi.fn();
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: () => 11,
      paste,
      setTarget,
    });

    expect(target.dropPath(["/repo/My File.ts"], 40, 50)).toBe(true);
    expect(setTarget).toHaveBeenCalledWith(null);
    await vi.waitFor(() => expect(paste).toHaveBeenCalledWith(11, "'/repo/My File.ts' "));
  });

  it("pastes multiple dropped paths quoted", async () => {
    const paste = vi.fn(() => true);
    const setTarget = vi.fn();
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: () => 11,
      paste,
      setTarget,
    });

    expect(target.dropPath(["/repo/a.ts", "/repo/b file.ts"], 40, 50)).toBe(
      true,
    );
    await vi.waitFor(() => expect(paste).toHaveBeenCalledWith(11, "/repo/a.ts '/repo/b file.ts' "));
  });

  it("clears stale state when a drop misses every terminal", () => {
    const paste = vi.fn(() => true);
    const setTarget = vi.fn();
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: () => null,
      paste,
      setTarget,
    });

    expect(target.dropPath(["/repo/file.ts"], 1, 2)).toBe(false);
    expect(setTarget).toHaveBeenCalledWith(null);
    expect(paste).not.toHaveBeenCalled();
  });
});

it.each([true, false])(
  "uses the destination shell dialect (Windows=%s)",
  (windows) => {
    const paste = vi.fn(() => true);
    const target = createTerminalPathDropTarget({
      leafIdAtPoint: () => 3,
      paste,
      setTarget: vi.fn(),
      dialect: () => (windows ? "powershell" : "posix"),
    });
    target.dropPath(["/mnt/c/it's $(Get-Date).txt"], 1, 2);
    expect(paste).toHaveBeenCalledWith(
      3,
      windows
        ? "'/mnt/c/it''s $(Get-Date).txt' "
        : "'/mnt/c/it'\\''s $(Get-Date).txt' ",
    );
  },
);

it("uses PowerShell quoting for a Unix PowerShell session", async () => {
  native.invoke.mockResolvedValue("/usr/bin/pwsh");
  const paste = vi.fn(() => true);
  const target = createTerminalPathDropTarget({ leafIdAtPoint: () => 3, paste, setTarget: vi.fn() });
  target.dropPath(["/tmp/a\\b"], 1, 2);
  await vi.waitFor(() => expect(paste).toHaveBeenCalledWith(3, "/tmp/a\\b "));
  expect(native.invoke).toHaveBeenCalledWith("pty_session_shell", { id: 9 });
});

it("discards a shell lookup after the destination PTY changes", async () => {
  const paste = vi.fn(() => true);
  const target = createTerminalPathDropTarget({ leafIdAtPoint: () => 3, paste, setTarget: vi.fn() });
  target.dropPath(["/tmp/file"], 1, 2);
  native.ptyId.mockReturnValue(10);
  await Promise.resolve();
  await Promise.resolve();
  expect(paste).not.toHaveBeenCalled();
});
