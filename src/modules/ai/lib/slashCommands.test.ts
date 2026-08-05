import { beforeEach, describe, expect, it, vi } from "vitest";

const planMock = vi.hoisted(() => ({
  active: false,
  disable: vi.fn(),
  toggle: vi.fn(),
}));

vi.mock("../store/planStore", () => ({
  usePlanStore: {
    getState: () => ({
      active: planMock.active,
      disable: planMock.disable,
      toggle: planMock.toggle,
    }),
  },
}));

import {
  TERAX_CMD_RE,
  tryRunSlashCommand,
  wrapWithCommandMarker,
} from "./slashCommands";

beforeEach(() => {
  vi.clearAllMocks();
  planMock.active = false;
});

describe("wrapWithCommandMarker / TERAX_CMD_RE", () => {
  it("wraps a prompt with a command marker", () => {
    expect(wrapWithCommandMarker("hi", "init")).toBe(
      '<terax-command name="init" />\n\nhi',
    );
  });

  it("parses the marker the wrapper emits", () => {
    const match = wrapWithCommandMarker("body", "plan").match(TERAX_CMD_RE);
    expect(match?.[1]).toBe("plan");
  });

  it("captures an optional state attribute", () => {
    const match = '<terax-command name="plan" state="on" />\n\nx'.match(
      TERAX_CMD_RE,
    );
    expect([match?.[1], match?.[2]]).toEqual(["plan", "on"]);
  });
});

describe("tryRunSlashCommand", () => {
  it("ignores text that is not a slash or hash command", () => {
    expect(tryRunSlashCommand("hello world")).toEqual({ kind: "none" });
  });

  it("expands /init into a send-prompt outcome", () => {
    const out = tryRunSlashCommand("/init");
    expect(out).toMatchObject({ kind: "send-prompt", commandName: "init" });
  });

  it("shows usage for /claude-code with no request", () => {
    expect(tryRunSlashCommand("/claude-code")).toEqual({
      kind: "handled",
      toast: "Usage: /claude-code <request>",
    });
  });

  it("wraps a /claude-code request into a send-prompt outcome", () => {
    const out = tryRunSlashCommand("/claude-code fix the bug");
    expect(out).toMatchObject({
      kind: "send-prompt",
      commandName: "claude-code",
    });
  });

  it("accepts a known command with the # prefix", () => {
    expect(tryRunSlashCommand("#init").kind).toBe("send-prompt");
  });

  it("ignores an unknown # command", () => {
    expect(tryRunSlashCommand("#nope")).toEqual({ kind: "none" });
  });

  it("turns plan mode off with /plan off", () => {
    const out = tryRunSlashCommand("/plan off");
    expect(out).toEqual({ kind: "handled", toast: "Plan mode off" });
    expect(planMock.disable).toHaveBeenCalled();
    expect(planMock.toggle).not.toHaveBeenCalled();
  });

  it("toggles plan mode with a bare /plan", () => {
    planMock.active = true; // reflects the state after toggle()
    const out = tryRunSlashCommand("/plan");
    expect(out).toEqual({ kind: "handled", toast: "Plan mode on" });
    expect(planMock.toggle).toHaveBeenCalled();
  });
});
