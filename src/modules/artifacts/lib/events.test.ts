import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  onArtifactDelete,
  onArtifactUpdate,
} from "@/modules/artifacts/lib/events";

const callbacks = vi.hoisted(
  () => new Map<string, (event: { payload: unknown }) => void>(),
);

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (event: string, callback: (event: { payload: unknown }) => void) => {
      callbacks.set(event, callback);
      return () => callbacks.delete(event);
    },
  ),
}));

describe("artifact event subscriptions", () => {
  beforeEach(() => {
    callbacks.clear();
    vi.mocked(listen).mockClear();
  });

  it("subscribes to artifact update events", async () => {
    const updates: unknown[] = [];
    const unlisten = await onArtifactUpdate((payload) => updates.push(payload));

    callbacks.get("artifact:update")?.({
      payload: { conversationId: "pi-1", reason: "create" },
    });

    expect(updates).toEqual([{ conversationId: "pi-1", reason: "create" }]);
    unlisten();
    expect(callbacks.has("artifact:update")).toBe(false);
  });

  it("subscribes to artifact delete events", async () => {
    const deletes: unknown[] = [];
    await onArtifactDelete((payload) => deletes.push(payload));

    callbacks.get("artifact:delete")?.({
      payload: { conversationId: "pi-1", slug: "hero" },
    });

    expect(deletes).toEqual([{ conversationId: "pi-1", slug: "hero" }]);
  });
});
