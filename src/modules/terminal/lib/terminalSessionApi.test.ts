import * as ghosttySession from "@/modules/terminal/ghostty/useGhosttyTerminalSession";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFocusedTerminal,
  disposeSession,
  registerXtermSessionAdapter,
  whenSessionReady,
  writeToSession,
} from "./terminalSessionApi";

vi.mock("@/modules/terminal/ghostty/useGhosttyTerminalSession", () => ({
  clearGhosttySession: vi.fn(() => false),
  disposeGhosttySession: vi.fn(() => false),
  ghosttyFocusedLeaf: vi.fn(() => null),
  ghosttyLeafHasForegroundProcess: vi.fn(async () => false),
  ghosttyLeafIdForPty: vi.fn(() => null),
  ghosttyPtyIdForLeaf: vi.fn(() => null),
  hasGhosttySession: vi.fn(() => false),
  interruptGhosttySession: vi.fn(() => false),
  pasteIntoGhosttySession: vi.fn(() => false),
  respawnGhosttySession: vi.fn(async () => false),
  submitToGhosttySession: vi.fn(() => false),
  whenGhosttySessionReady: vi.fn(async () => true),
  writeToGhosttySession: vi.fn(() => false),
}));

describe("terminalSessionApi", () => {
  let adapter: ReturnType<typeof createAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ghosttySession.writeToGhosttySession).mockReturnValue(false);
    vi.mocked(ghosttySession.ghosttyFocusedLeaf).mockReturnValue(null);
    vi.mocked(ghosttySession.clearGhosttySession).mockReturnValue(false);
    vi.mocked(ghosttySession.disposeGhosttySession).mockReturnValue(false);
    vi.mocked(ghosttySession.hasGhosttySession).mockReturnValue(false);
    adapter = createAdapter();
    registerXtermSessionAdapter(adapter);
  });

  it("uses the Ghostty session before touching the lazy xterm adapter", () => {
    vi.mocked(ghosttySession.writeToGhosttySession).mockReturnValue(true);

    expect(writeToSession(7, "hello")).toBe(true);
    expect(adapter.writeToSession).not.toHaveBeenCalled();
  });

  it("routes a non-Ghostty leaf to the registered xterm adapter", () => {
    adapter.writeToSession.mockReturnValue(true);

    expect(writeToSession(8, "fallback")).toBe(true);
    expect(adapter.writeToSession).toHaveBeenCalledWith(8, "fallback");
  });

  it("clears and disposes focused Ghostty sessions without xterm work", () => {
    vi.mocked(ghosttySession.ghosttyFocusedLeaf).mockReturnValue(9);
    vi.mocked(ghosttySession.clearGhosttySession).mockReturnValue(true);
    vi.mocked(ghosttySession.disposeGhosttySession).mockReturnValue(true);

    expect(clearFocusedTerminal()).toBe(true);
    disposeSession(9);

    expect(adapter.clearFocusedTerminal).not.toHaveBeenCalled();
    expect(adapter.disposeSession).not.toHaveBeenCalled();
  });

  it("waits on an existing Ghostty model without loading xterm", async () => {
    vi.mocked(ghosttySession.hasGhosttySession).mockReturnValue(true);

    await whenSessionReady(10);

    expect(ghosttySession.whenGhosttySessionReady).toHaveBeenCalledWith(10);
    expect(adapter.whenSessionReady).not.toHaveBeenCalled();
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
      expect(adapter.whenSessionReady).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

function createAdapter() {
  return {
    blockWatermarkState: vi.fn(() => "hidden" as const),
    clearFocusedTerminal: vi.fn(() => false),
    clearLeafBlockSelection: vi.fn(() => false),
    disposeSession: vi.fn(),
    focusLeafInput: vi.fn(),
    getLeafBlockMode: vi.fn(() => "prompt" as const),
    getLeafDraft: vi.fn(() => ""),
    hasXtermSession: vi.fn(() => false),
    interruptLeaf: vi.fn(),
    leafCwd: vi.fn(() => null),
    leafGridSelection: vi.fn(() => null),
    leafHasForegroundProcess: vi.fn(async () => false),
    leafIdForPty: vi.fn(() => null),
    navigateFocusedBlocks: vi.fn(() => false),
    pasteIntoSession: vi.fn(() => false),
    ptyIdForLeaf: vi.fn(() => null),
    respawnSession: vi.fn(async () => undefined),
    setLeafDraft: vi.fn(),
    setLeafInputActivity: vi.fn(),
    setLeafInputFocus: vi.fn(),
    submitToLeaf: vi.fn(),
    subscribeLeafBlockMode: vi.fn(() => () => {}),
    whenSessionReady: vi.fn(async () => undefined),
    writeToSession: vi.fn(() => false),
  } satisfies Parameters<typeof registerXtermSessionAdapter>[0];
}
