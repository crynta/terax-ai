import { describe, expect, it } from "vitest";
import { exitAction, RESPAWN_MIN_LIFETIME_MS } from "./terminalExit";

describe("exitAction", () => {
  it("quits with the window's only terminal", () => {
    expect(
      exitAction({ onlyTabInWindow: true, mustStay: true, livedMs: 10 }),
    ).toBe("close-window");
  });

  it("closes any tab that may close", () => {
    expect(
      exitAction({ onlyTabInWindow: false, mustStay: false, livedMs: 10 }),
    ).toBe("close");
  });

  it("respawns a project's last shell after it ran a while", () => {
    expect(
      exitAction({
        onlyTabInWindow: false,
        mustStay: true,
        livedMs: RESPAWN_MIN_LIFETIME_MS,
      }),
    ).toBe("respawn");
  });

  it("keeps a shell that died at once instead of respawning it in a loop", () => {
    expect(
      exitAction({
        onlyTabInWindow: false,
        mustStay: true,
        livedMs: RESPAWN_MIN_LIFETIME_MS - 1,
      }),
    ).toBe("keep");
  });
});
