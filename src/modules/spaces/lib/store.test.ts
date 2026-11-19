import { beforeEach, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    entries = async () => [...disk.entries()];
    keys = async () => [...disk.keys()];
    get = async (key: string) => disk.get(key);
    set = async (key: string, value: unknown) => {
      disk.set(key, value);
    };
    delete = async (key: string) => disk.delete(key);
    save = async () => {};
  },
}));

import {
  deleteSpaceData,
  loadAll,
  saveWorkbenchBackup,
  saveWorkbenchState,
} from "./store";

beforeEach(() => disk.clear());

it("leaves partial legacy data untouched when writing a migrated project", async () => {
  const legacy = { tabs: [null, { kind: "editor", path: "/repo/file.ts" }] };
  disk.set("state:p", legacy);
  await saveWorkbenchState("p", { version: 1, tasks: [] });
  expect(disk.get("state:p")).toBe(legacy);
  expect((await loadAll()).legacy.get("p")).toBe(legacy);
});

it("retains earlier recovery copies across subsequent damaged restores", async () => {
  await saveWorkbenchBackup("p", { version: 2, tasks: ["first"] });
  await saveWorkbenchBackup("p", { version: 3, tasks: ["second"] });
  const backups = [...disk.entries()].filter(([key]) =>
    key.startsWith("workbench-backup:p"),
  );
  expect(backups.map(([, value]) => value)).toEqual([
    { version: 2, tasks: ["first"] },
    { version: 3, tasks: ["second"] },
  ]);
  expect((await loadAll()).workbench.size).toBe(0);
  disk.set("state:p", {});
  disk.set("workbench:p", {});
  disk.set("workbench-backup:other", { keep: true });
  await deleteSpaceData("p");
  expect([...disk.keys()]).toEqual(["workbench-backup:other"]);
});
