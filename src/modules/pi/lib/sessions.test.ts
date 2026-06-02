import { describe, expect, it } from "vitest";
import type { PiSession } from "./sessions";
import { upsertPiSession } from "./sessions";

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
