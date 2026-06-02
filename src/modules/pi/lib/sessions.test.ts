import { describe, expect, it } from "vitest";
import type { PiSession, PiSessionEvent } from "./sessions";
import {
  applyPiSessionEvents,
  buildPiSessionTranscript,
  upsertPiSession,
} from "./sessions";

function session(id: string, status: PiSession["status"]): PiSession {
  return {
    id,
    title: id,
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastPrompt: null,
  };
}

function event(
  id: string,
  type: string,
  payload: PiSessionEvent["payload"],
): PiSessionEvent {
  return {
    id,
    type,
    sessionId: "pi-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    payload,
  };
}

describe("buildPiSessionTranscript", () => {
  it("orders events chronologically and coalesces output deltas", () => {
    expect(
      buildPiSessionTranscript([
        event("evt-10", "session.output.delta", { text: "?" }),
        event("evt-9", "session.output.delta", { text: "help" }),
        event("evt-8", "session.output.delta", { text: "I" }),
        event("evt-7", "session.output.delta", { text: "can" }),
        event("evt-6", "session.output.delta", { text: "How" }),
        event("evt-5", "session.output.delta", { text: "!" }),
        event("evt-4", "session.output.delta", { text: "Hey" }),
        event("evt-3", "session.status", { status: "running" }),
        event("evt-2", "session.input", { text: "Hey" }),
        event("evt-1", "session.created", {}),
      ]),
    ).toEqual([
      expect.objectContaining({ kind: "system", label: "Created" }),
      expect.objectContaining({ kind: "user", label: "Prompt", text: "Hey" }),
      expect.objectContaining({
        kind: "system",
        label: "Status",
        text: "running",
      }),
      expect.objectContaining({
        kind: "assistant",
        label: "Pi",
        text: "Hey! How can I help?",
        eventIds: [
          "evt-4",
          "evt-5",
          "evt-6",
          "evt-7",
          "evt-8",
          "evt-9",
          "evt-10",
        ],
      }),
    ]);
  });
});

describe("applyPiSessionEvents", () => {
  it("uses the latest chronological status when restored events are newest-first", () => {
    expect(
      applyPiSessionEvents(
        [session("pi-1", "running")],
        [
          event("evt-11", "session.status", { status: "idle" }),
          event("evt-3", "session.status", { status: "running" }),
        ],
      ),
    ).toEqual([session("pi-1", "idle")]);
  });
});

describe("upsertPiSession", () => {
  it("prepends new sessions", () => {
    expect(
      upsertPiSession([session("pi-1", "idle")], session("pi-2", "idle")),
    ).toEqual([session("pi-2", "idle"), session("pi-1", "idle")]);
  });

  it("replaces existing sessions in place", () => {
    expect(
      upsertPiSession(
        [session("pi-2", "idle"), session("pi-1", "idle")],
        session("pi-1", "running"),
      ),
    ).toEqual([session("pi-2", "idle"), session("pi-1", "running")]);
  });
});
