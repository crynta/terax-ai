import { describe, expect, it, vi } from "vitest";
import {
  applyArtifactDelete,
  applyArtifactUpdate,
  createArtifactCollectionStore,
} from "@/modules/artifacts/lib/collection";
import type {
  ArtifactDeleteEvent,
  ArtifactUpdateEvent,
} from "@/modules/artifacts/lib/types";
import type { ArtifactSummary } from "@/modules/artifacts/lib/types";

function summary(
  conversationId: string,
  slug: string,
  version: number,
): ArtifactSummary {
  return {
    conversationId,
    slug,
    title: slug,
    kind: "html",
    version,
    contentHash: "a".repeat(64),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: `2026-01-01T00:00:0${version}.000Z`,
    contentBytes: version,
  };
}

describe("artifact collection reducers", () => {
  it("upserts updates for the active conversation only", () => {
    const current = [summary("pi-1", "hero", 1)];
    const next = applyArtifactUpdate(
      current,
      "pi-1",
      summary("pi-1", "hero", 2),
    );
    const ignored = applyArtifactUpdate(
      next,
      "pi-1",
      summary("pi-2", "other", 1),
    );

    expect(next).toHaveLength(1);
    expect(next[0].version).toBe(2);
    expect(ignored).toEqual(next);
  });

  it("removes deleted artifacts for the active conversation", () => {
    const current = [summary("pi-1", "hero", 1), summary("pi-1", "doc", 1)];
    const next = applyArtifactDelete(current, "pi-1", {
      conversationId: "pi-1",
      slug: "hero",
    });

    expect(next.map((item) => item.slug)).toEqual(["doc"]);
  });
});

describe("artifact collection store", () => {
  it("dedupes native list requests and event listeners across subscribers", async () => {
    const snapshotsA: ArtifactSummary[][] = [];
    const snapshotsB: ArtifactSummary[][] = [];
    const unlistens: Array<() => void> = [];
    let updateHandler: ((payload: ArtifactUpdateEvent) => void) | null = null;
    let deleteHandler: ((payload: ArtifactDeleteEvent) => void) | null = null;
    const list = vi.fn(async () => [summary("pi-1", "hero", 1)]);
    const onUpdate = vi.fn(async (handler) => {
      updateHandler = handler;
      const unlisten = vi.fn();
      unlistens.push(unlisten);
      return unlisten;
    });
    const onDelete = vi.fn(async (handler) => {
      deleteHandler = handler;
      const unlisten = vi.fn();
      unlistens.push(unlisten);
      return unlisten;
    });
    const store = createArtifactCollectionStore({
      list,
      onDelete,
      onUpdate,
    });

    const unsubscribeA = store.subscribe("pi-1", (snapshot) => {
      snapshotsA.push(snapshot.artifacts);
    });
    const unsubscribeB = store.subscribe("pi-1", (snapshot) => {
      snapshotsB.push(snapshot.artifacts);
    });
    await store.refresh("pi-1");

    const latestSnapshot = (snapshots: ArtifactSummary[][]) =>
      snapshots[snapshots.length - 1];
    const emitUpdate = (payload: ArtifactUpdateEvent) => {
      const handler = updateHandler as
        | ((payload: ArtifactUpdateEvent) => void)
        | null;
      if (!handler) throw new Error("missing update handler");
      handler(payload);
    };
    const emitDelete = (payload: ArtifactDeleteEvent) => {
      const handler = deleteHandler as
        | ((payload: ArtifactDeleteEvent) => void)
        | null;
      if (!handler) throw new Error("missing delete handler");
      handler(payload);
    };

    expect(list).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(latestSnapshot(snapshotsA)?.map((item) => item.slug)).toEqual([
      "hero",
    ]);
    expect(latestSnapshot(snapshotsB)?.map((item) => item.slug)).toEqual([
      "hero",
    ]);

    emitUpdate({
      type: "artifact:update",
      conversationId: "pi-1",
      artifact: summary("pi-1", "hero", 2),
      reason: "update",
    });
    expect(latestSnapshot(snapshotsA)?.[0]?.version).toBe(2);
    expect(latestSnapshot(snapshotsB)?.[0]?.version).toBe(2);

    emitDelete({
      type: "artifact:delete",
      conversationId: "pi-1",
      slug: "hero",
    });
    expect(latestSnapshot(snapshotsA)).toEqual([]);
    expect(latestSnapshot(snapshotsB)).toEqual([]);

    unsubscribeA();
    unsubscribeB();
    await Promise.resolve();

    expect(unlistens).toHaveLength(2);
    expect(
      unlistens.every(
        (unlisten) => vi.mocked(unlisten).mock.calls.length === 1,
      ),
    ).toBe(true);
  });
});
