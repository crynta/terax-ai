import { describe, expect, it, vi } from "vitest";
import { migrateLegacySpace } from "./legacyMigration";
import { fingerprint, WORKBENCH_VERSION } from "./persistence";
import { restoreProject } from "./restore";

function alloc(start = 1) {
  let id = start;
  return () => id++;
}

const legacy = {
  activeTabIndex: 0,
  tabs: [{ kind: "terminal", tree: { kind: "leaf", cwd: "/legacy" } }],
};

const workbench = (extra: object = {}) => ({
  version: WORKBENCH_VERSION,
  activeTask: 0,
  tasks: [
    {
      kind: "main",
      createdAt: 1,
      focused: 0,
      layout: {
        kind: "card",
        active: 0,
        tabs: [{ kind: "terminal", cwd: "/workbench" }],
      },
    },
  ],
  ...extra,
});

function cwdOf(result: Awaited<ReturnType<typeof restoreProject>>) {
  const tab = result.project.tabs[0];
  return tab?.kind === "terminal" ? tab.cwd : undefined;
}

async function restore(stored: unknown, legacyRaw: unknown) {
  const load = vi.fn(async () => migrateLegacySpace);
  const result = await restoreProject(stored, legacyRaw, "p", alloc(), load);
  return { result, load };
}

describe("restoreProject", () => {
  it("restores the workbench state reconciled with the legacy entry on disk", async () => {
    const { result, load } = await restore(
      workbench({ legacy: fingerprint(legacy) }),
      legacy,
    );
    expect(cwdOf(result)).toBe("/workbench");
    expect(result.backup).toBe(false);
    expect(result.legacy).toBe(fingerprint(legacy));
    expect(load).not.toHaveBeenCalled();
  });

  it("migrates again when an older build changed the legacy entry since", async () => {
    const changed = { ...legacy, activeTabIndex: 1 };
    const { result, load } = await restore(
      workbench({ legacy: fingerprint(legacy) }),
      changed,
    );
    expect(cwdOf(result)).toBe("/legacy");
    expect(result.backup).toBe(true);
    expect(result.legacy).toBe(fingerprint(changed));
    expect(load).toHaveBeenCalledOnce();
  });

  it("migrates over a state that never recorded its legacy entry", async () => {
    const { result } = await restore(workbench(), legacy);
    expect(cwdOf(result)).toBe("/legacy");
    expect(result.backup).toBe(true);
  });

  it("migrates a project only the legacy format knows, without a backup", async () => {
    const { result } = await restore(undefined, legacy);
    expect(cwdOf(result)).toBe("/legacy");
    expect(result.backup).toBe(false);
  });

  it("never discards a state from a newer build", async () => {
    const newer = { ...workbench(), version: WORKBENCH_VERSION + 1 };
    const alone = (await restore(newer, undefined)).result;
    expect(alone.project.tasks).toEqual([]);
    expect(alone.backup).toBe(true);
    const withLegacy = (await restore(newer, legacy)).result;
    expect(cwdOf(withLegacy)).toBe("/legacy");
    expect(withLegacy.backup).toBe(true);
  });

  it("backs up a state it could only read in part", async () => {
    const lossy = workbench();
    lossy.tasks.push({ kind: "local" } as never);
    const { result } = await restore(lossy, undefined);
    expect(result.project.tasks).toHaveLength(1);
    expect(result.project.dropped).toBeGreaterThan(0);
    expect(result.backup).toBe(true);
  });

  it("has nothing to restore for a new project", async () => {
    const { result, load } = await restore(undefined, undefined);
    expect(result.project.tasks).toEqual([]);
    expect(result.backup).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });
});

it.each([null, {}, { tabs: [null, { kind: "terminal" }] }])(
  "keeps a readable workbench when the legacy entry is corrupt: %j",
  async (raw) => {
    const { result } = await restore(workbench(), raw);
    expect(cwdOf(result)).toBe("/workbench");
    expect(result.backup).toBe(false);
  },
);

it("preserves both input blobs when loading or running migration fails", async () => {
  const saved = workbench();
  const before = JSON.stringify({ saved, legacy });
  for (const load of [
    async () => {
      throw new Error("load failed");
    },
    async () =>
      (() => {
        throw new Error("migration failed");
      }) as typeof migrateLegacySpace,
  ]) {
    await expect(
      restoreProject(saved, legacy, "p", alloc(), load),
    ).rejects.toThrow();
    expect(JSON.stringify({ saved, legacy })).toBe(before);
  }
});

it("backs up a partial workbench envelope without a task array", async () => {
  const { result } = await restore({ version: WORKBENCH_VERSION }, undefined);
  expect(result.backup).toBe(true);
});
