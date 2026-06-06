import { describe, expect, it } from "vitest";
import { deletePiSessionWithArtifactCleanup } from "@/modules/pi/lib/sessionLifecycle";
import type { PiSessionDeleteResult } from "@/modules/pi/lib/sessions";

const deleteResult: PiSessionDeleteResult = {
  events: [
    {
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "evt-1",
      payload: {},
      sessionId: "pi-1",
      type: "session.deleted",
    },
  ],
};

describe("Pi session lifecycle cleanup", () => {
  it("delegates session and artifact deletion to the backend", async () => {
    const calls: string[] = [];

    const result = await deletePiSessionWithArtifactCleanup({
      deleteSessionWithArtifacts: async (sessionId) => {
        calls.push(`backend:${sessionId}`);
        return {
          sessionDelete: deleteResult,
          artifactDelete: { deleted: true, deletedCount: 2 },
          artifactCleanupError: null,
        };
      },
      sessionId: "pi-1",
    });

    expect(calls).toEqual(["backend:pi-1"]);
    expect(result.sessionDelete).toBe(deleteResult);
    expect(result.artifactDelete).toEqual({ deleted: true, deletedCount: 2 });
    expect(result.artifactCleanupError).toBeNull();
  });

  it("preserves backend artifact cleanup errors without a second frontend call", async () => {
    const result = await deletePiSessionWithArtifactCleanup({
      deleteSessionWithArtifacts: async () => ({
        sessionDelete: deleteResult,
        artifactDelete: null,
        artifactCleanupError: "artifact store unavailable",
      }),
      sessionId: "pi-1",
    });

    expect(result.sessionDelete).toBe(deleteResult);
    expect(result.artifactDelete).toBeNull();
    expect(result.artifactCleanupError).toBe("artifact store unavailable");
  });
});
