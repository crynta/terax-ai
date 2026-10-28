import { describe, expect, it } from "vitest";
import {
  CLOSE_FLUSH_TIMEOUT_MS,
  canOptOutOfAppClosePrompt,
  closeAfterFlush,
} from "./useAppCloseGuard";

describe("canOptOutOfAppClosePrompt", () => {
  it("offers the opt-out when a running process is the only blocker", () => {
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 0, busyTerminal: true }),
    ).toBe(true);
  });

  it("withholds the opt-out whenever unsaved changes are also at stake", () => {
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 1, busyTerminal: true }),
    ).toBe(false);
    expect(
      canOptOutOfAppClosePrompt({ dirtyEditors: 2, busyTerminal: false }),
    ).toBe(false);
  });
});

describe("closeAfterFlush", () => {
  it("closes straight away when chat history was saved", () => {
    expect(closeAfterFlush({ ok: true }, false)).toBe("close");
  });

  it("keeps the window open once, with an error, when saving failed", () => {
    expect(closeAfterFlush({ ok: false }, false)).toBe("warn");
  });

  it("never traps the user: after the warning every close request closes", () => {
    expect(closeAfterFlush({ ok: false }, true)).toBe("close");
  });

  it("bounds how long closing waits for the disk", () => {
    expect(CLOSE_FLUSH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CLOSE_FLUSH_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });
});
