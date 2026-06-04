import { describe, expect, it } from "vitest";
import type { PiSessionEvent } from "./sessions";
import {
  buildPiAgentSessionStateForEvent,
  buildPiNotificationForEvent,
} from "./notifications";

function event(
  type: string,
  payload: PiSessionEvent["payload"],
): PiSessionEvent {
  return {
    id: `evt-${type}`,
    type,
    sessionId: "pi-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    payload,
  };
}

describe("buildPiNotificationForEvent", () => {
  it("notifies when a running Pi session finishes", () => {
    expect(
      buildPiNotificationForEvent(event("session.status", { status: "idle" }), {
        lastPrompt: "Explain the auth flow in one paragraph",
        previousStatus: "running",
        title: "Auth help",
      }),
    ).toEqual({
      body: "Explain the auth flow in one paragraph",
      kind: "finished",
      sessionId: "pi-1",
      title: "Pi response ready",
    });
  });

  it("does not notify for restored idle status without a prior run", () => {
    expect(
      buildPiNotificationForEvent(event("session.status", { status: "idle" }), {
        previousStatus: "idle",
        title: "Idle",
      }),
    ).toBeNull();
  });

  it("notifies immediately for Pi session errors", () => {
    expect(
      buildPiNotificationForEvent(
        event("session.error", { message: "API key missing" }),
        { previousStatus: "running", title: "Broken run" },
      ),
    ).toEqual({
      body: "API key missing",
      kind: "error",
      sessionId: "pi-1",
      title: "Pi run failed",
    });
  });

  it("truncates long prompt bodies for notification rows", () => {
    const longPrompt = `${"x".repeat(90)} tail`;

    expect(
      buildPiNotificationForEvent(event("session.status", { status: "idle" }), {
        lastPrompt: longPrompt,
        previousStatus: "running",
      })?.body,
    ).toBe(`${"x".repeat(80)}…`);
  });
});

describe("buildPiAgentSessionStateForEvent", () => {
  it("maps a running Pi event into live working activity", () => {
    expect(
      buildPiAgentSessionStateForEvent(
        event("session.status", { status: "running" }),
        {
          lastPrompt: "Implement issue 626",
          title: "Agent status",
        },
      ),
    ).toEqual({
      body: "Implement issue 626",
      lastActivityAt: Date.parse("2026-01-01T00:00:00.000Z"),
      sessionId: "pi-1",
      status: "working",
      title: "Agent status",
    });
  });

  it("marks a previously running Pi session as finished when it returns idle", () => {
    expect(
      buildPiAgentSessionStateForEvent(
        event("session.status", { status: "idle" }),
        {
          lastPrompt: "Implement issue 626",
          previousStatus: "running",
          title: "Agent status",
        },
      )?.status,
    ).toBe("finished");
  });

  it("ignores restored idle Pi sessions that did not just finish", () => {
    expect(
      buildPiAgentSessionStateForEvent(
        event("session.status", { status: "idle" }),
        {
          previousStatus: "idle",
          title: "Agent status",
        },
      ),
    ).toBeNull();
  });
});
