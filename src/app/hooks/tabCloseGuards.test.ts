import { describe, expect, it, vi } from "vitest";
import {
  type CloseHazardSnapshot,
  type CloseManyHazards,
  deletedEditorTabs,
  evaluateCloseHazards,
  hasCloseManyHazards,
  hasNewCloseManyHazards,
} from "./tabCloseGuards";
import type { EditorTab } from "@/modules/tabs";

function hazards(
  dirtyIds: number[] = [],
  busyLeafIds: number[] = [],
): CloseManyHazards {
  return { dirtyIds, busyLeafIds };
}

function snapshots(
  ...frames: CloseHazardSnapshot[]
): () => CloseHazardSnapshot {
  let index = 0;
  return () => frames[Math.min(index++, frames.length - 1)];
}

describe("close-many hazards", () => {
  it("requires a guard for dirty editors or busy terminal leaves", () => {
    expect(hasCloseManyHazards(hazards())).toBe(false);
    expect(hasCloseManyHazards(hazards([2]))).toBe(true);
    expect(hasCloseManyHazards(hazards([], [20]))).toBe(true);
  });

  it("accepts confirmation when the acknowledged hazards are unchanged", () => {
    const acknowledged = hazards([2], [20]);
    expect(hasNewCloseManyHazards(acknowledged, hazards([2], [20]))).toBe(
      false,
    );
  });

  it("accepts confirmation when acknowledged hazards have cleared", () => {
    const acknowledged = hazards([2, 3], [20, 30]);
    expect(hasNewCloseManyHazards(acknowledged, hazards([2], [30]))).toBe(
      false,
    );
  });

  it("requires another confirmation for a newly dirty editor", () => {
    expect(hasNewCloseManyHazards(hazards([2]), hazards([2, 3]))).toBe(true);
  });

  it("requires another confirmation for a newly busy terminal leaf", () => {
    expect(
      hasNewCloseManyHazards(hazards([], [20]), hazards([], [20, 30])),
    ).toBe(true);
  });
});

describe("deletedEditorTabs", () => {
  const editor = (
    id: number,
    path: string,
    dirty: boolean,
    spaceId = "local",
  ): EditorTab => ({
    id,
    kind: "editor",
    title: path,
    path,
    dirty,
    preview: false,
    spaceId,
  });

  it("collects every dirty editor affected by unrelated batch paths", () => {
    expect(
      deletedEditorTabs(
        [
          editor(1, "/repo/a.ts", true),
          editor(2, "/repo/b.ts", true),
          editor(3, "/repo/clean.ts", false),
        ],
        ["/repo/a.ts", "/repo/b.ts", "/repo/clean.ts"],
        new Set(["local"]),
      ),
    ).toEqual({ dirtyIds: [1, 2], cleanIds: [3] });
  });

  it("includes descendants but excludes matching paths from another workspace", () => {
    expect(
      deletedEditorTabs(
        [
          editor(1, "/repo/src/a.ts", true, "ubuntu"),
          editor(2, "/repo/src/a.ts", true, "debian"),
        ],
        ["/repo/src"],
        new Set(["ubuntu"]),
      ),
    ).toEqual({ dirtyIds: [1], cleanIds: [] });
  });
});

describe("evaluateCloseHazards", () => {
  const snapshot = { dirtyIds: [2], leafIds: [20, 30] };

  it("reports only the leaves that are actually busy", async () => {
    const isBusy = vi.fn(async (id: number) => id === 30);
    await expect(
      evaluateCloseHazards(() => snapshot, isBusy, true),
    ).resolves.toEqual(hazards([2], [30]));
  });

  it("skips foreground-process IPC when the user opted out", async () => {
    const isBusy = vi.fn(async () => true);
    await expect(
      evaluateCloseHazards(() => snapshot, isBusy, false),
    ).resolves.toEqual(hazards([2], []));
    expect(isBusy).not.toHaveBeenCalled();
  });

  it("still reports dirty editors when the user opted out", async () => {
    await expect(
      evaluateCloseHazards(
        () => ({ dirtyIds: [2, 3], leafIds: [20] }),
        async () => true,
        false,
      ),
    ).resolves.toEqual(hazards([2, 3], []));
  });

  it("re-checks when the leaf set changes mid-flight", async () => {
    const capture = snapshots(
      { dirtyIds: [], leafIds: [20] },
      { dirtyIds: [], leafIds: [20, 30] },
      { dirtyIds: [], leafIds: [20, 30] },
    );
    await expect(
      evaluateCloseHazards(capture, async (id) => id === 30, true),
    ).resolves.toEqual(hazards([], [30]));
  });

  it("assumes every leaf is busy when the set never settles", async () => {
    let last = 0;
    const capture = () => {
      last += 10;
      return { dirtyIds: [], leafIds: [last] };
    };
    const result = await evaluateCloseHazards(capture, async () => false, true);
    expect(result).toEqual(hazards([], [last]));
  });
});
