import * as ghosttySession from "@/modules/terminal/ghostty/useGhosttyTerminalSession";
import {
  ensureGhosttyBlocks,
  ghosttyBlocks,
} from "@/modules/terminal/ghostty/ghosttyBlockSessions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFocusedTerminal,
  disposeSession,
  leafCwd,
  leafGridSelection,
  whenSessionReady,
  writeToSession,
} from "./terminalSessionApi";

vi.mock("@/modules/terminal/ghostty/useGhosttyTerminalSession", () => ({
  clearGhosttySession: vi.fn(() => false),
  disposeGhosttySession: vi.fn(() => false),
  focusGhosttySession: vi.fn(),
  ghosttyFocusedLeaf: vi.fn(() => null),
  ghosttyLeafHasForegroundProcess: vi.fn(async () => false),
  ghosttyLeafIdForPty: vi.fn(() => null),
  ghosttyCwdForLeaf: vi.fn(() => "/workspace"),
  ghosttyPtyIdForLeaf: vi.fn(() => null),
  ghosttySelectionForLeaf: vi.fn(() => "selected output"),
  hasGhosttySession: vi.fn(() => false),
  interruptGhosttySession: vi.fn(() => false),
  pasteIntoGhosttySession: vi.fn(() => false),
  respawnGhosttySession: vi.fn(async () => false),
  submitToGhosttySession: vi.fn(() => false),
  whenGhosttySessionReady: vi.fn(async () => true),
  writeToGhosttySession: vi.fn(() => false),
}));

describe("terminalSessionApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ghosttySession.writeToGhosttySession).mockReturnValue(false);
    vi.mocked(ghosttySession.ghosttyFocusedLeaf).mockReturnValue(null);
    vi.mocked(ghosttySession.clearGhosttySession).mockReturnValue(false);
    vi.mocked(ghosttySession.disposeGhosttySession).mockReturnValue(false);
    vi.mocked(ghosttySession.hasGhosttySession).mockReturnValue(false);
  });

  it("writes directly to the owning Ghostty session", () => {
    vi.mocked(ghosttySession.writeToGhosttySession).mockReturnValue(true);

    expect(writeToSession(7, "hello")).toBe(true);
  });

  it("returns failure when there is no accepting session", () => {
    expect(writeToSession(8, "data")).toBe(false);
  });

  it("routes cwd and grid selection to the owning Ghostty model", () => {
    vi.mocked(ghosttySession.hasGhosttySession).mockReturnValue(true);
    expect(leafCwd(7)).toBe("/workspace");
    expect(leafGridSelection(7)).toBe("selected output");
  });

  it("clears and disposes focused Ghostty sessions through the Ghostty session", () => {
    vi.mocked(ghosttySession.ghosttyFocusedLeaf).mockReturnValue(9);
    vi.mocked(ghosttySession.clearGhosttySession).mockReturnValue(true);
    vi.mocked(ghosttySession.disposeGhosttySession).mockReturnValue(true);

    expect(clearFocusedTerminal()).toBe(true);
    disposeSession(9);
    expect(ghosttySession.disposeGhosttySession).toHaveBeenCalledWith(9);
  });

  it("waits on an existing Ghostty model and releases its readiness timer", async () => {
    vi.mocked(ghosttySession.hasGhosttySession).mockReturnValue(true);

    await whenSessionReady(10);

    expect(ghosttySession.whenGhosttySessionReady).toHaveBeenCalledWith(10);
  });

  it("releases precreated block state when a leaf closes before initialization", () => {
    ensureGhosttyBlocks(12).draft = "pending input";
    disposeSession(12);
    expect(ghosttyBlocks(12)).toBeUndefined();
  });

  it("handles a Ghostty session created after the readiness request", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(ghosttySession.hasGhosttySession)
        .mockReturnValueOnce(false)
        .mockReturnValue(true);

      const ready = whenSessionReady(11);
      await vi.advanceTimersByTimeAsync(10);
      await ready;

      expect(ghosttySession.whenGhosttySessionReady).toHaveBeenCalledWith(11);
    } finally {
      vi.useRealTimers();
    }
  });
});
