import { describe, expect, it } from "vitest";
import type { ArtifactUpdateEvent } from "@/modules/artifacts/lib/types";
import { reduceChatArtifactUpdate } from "@/modules/pi/lib/chatArtifacts";

function update(conversationId: string, slug: string): ArtifactUpdateEvent {
  return {
    type: "artifact:update",
    conversationId,
    reason: "create",
    artifact: {
      conversationId,
      slug,
      title: slug,
      kind: "html",
      version: 1,
      contentHash: "a".repeat(64),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      contentBytes: 10,
    },
  };
}

describe("chat artifact sidecar state", () => {
  it("opens and selects artifacts for the active chat session", () => {
    const next = reduceChatArtifactUpdate(
      { open: false, selectedSlug: null },
      "pi-1",
      update("pi-1", "hero"),
    );

    expect(next).toEqual({ open: true, selectedSlug: "hero" });
  });

  it("ignores artifact updates for other sessions", () => {
    const current = { open: false, selectedSlug: null };
    const next = reduceChatArtifactUpdate(
      current,
      "pi-1",
      update("pi-2", "hero"),
    );

    expect(next).toBe(current);
  });
});
