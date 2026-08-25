import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@/modules/theme/types";

const core = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => core);

const paths = vi.hoisted(() => ({
  appConfigDir: vi.fn(async () => "/config"),
  join: vi.fn(async (...parts: string[]) => parts.join("/").replace(/\/+/g, "/")),
}));

vi.mock("@tauri-apps/api/path", () => paths);

vi.mock("@/modules/workspace", () => ({ currentWorkspaceEnv: () => "local" }));

const events = vi.hoisted(() => {
  const listeners: ((payload: unknown) => void)[] = [];
  return {
    listeners,
    listen: vi.fn(async (_event: string, handler: (payload: unknown) => void) => {
      listeners.push(handler);
      return () => undefined;
    }),
    emit: vi.fn(async () => undefined),
  };
});

vi.mock("@tauri-apps/api/event", () => events);

import { deleteThemeFile, emitThemeEdit, onThemeEdit, writeThemeFile } from "./themeFiles";

function theme(id = "my-theme"): Theme {
  return {
    id,
    name: "Mine",
    author: "",
    description: "",
    variants: {},
  };
}

describe("theme file persistence", () => {
  beforeEach(() => {
    events.listeners.length = 0;
    core.invoke.mockReset();
    core.invoke.mockResolvedValue(undefined);
    paths.appConfigDir.mockClear();
  });

  it("writes pretty-printed JSON into the themes dir without recreating it", async () => {
    const path = await writeThemeFile(theme());

    expect(path).toBe("/config/themes/my-theme.terax-theme");
    expect(core.invoke).toHaveBeenCalledWith("fs_stat", {
      path: "/config/themes",
      workspace: "local",
    });
    const calls = core.invoke.mock.calls.filter((c) => c[0] === "fs_create_dir");
    expect(calls).toHaveLength(0);
    expect(core.invoke).toHaveBeenLastCalledWith("fs_write_file", {
      path: "/config/themes/my-theme.terax-theme",
      content: JSON.stringify(theme(), null, 2),
      workspace: "local",
      source: "theme",
    });
  });

  it("creates the themes dir first when it does not exist yet", async () => {
    core.invoke.mockImplementation((cmd: string) =>
      cmd === "fs_stat" ? Promise.reject(new Error("missing")) : Promise.resolve(undefined),
    );

    await writeThemeFile(theme("t2"));

    expect(core.invoke).toHaveBeenCalledWith("fs_create_dir", {
      path: "/config/themes",
      workspace: "local",
    });
  });

  it("deletes a theme file and swallows a missing-file failure", async () => {
    await deleteThemeFile("my-theme");
    expect(core.invoke).toHaveBeenCalledWith("fs_delete", {
      path: "/config/themes/my-theme.terax-theme",
      workspace: "local",
    });

    core.invoke.mockRejectedValueOnce(new Error("enoent"));
    await expect(deleteThemeFile("gone")).resolves.toBeUndefined();
  });

  it("routes edit requests through the theme-edit event", async () => {
    const seen: unknown[] = [];
    const unlisten = await onThemeEdit((payload) => seen.push(payload));

    await emitThemeEdit({ action: "create" });
    await emitThemeEdit({ action: "edit", id: "my-theme" });
    await Promise.resolve();

    expect(events.listeners).toHaveLength(1);
    events.listeners[0]?.({ payload: { action: "create" } });
    events.listeners[0]?.({ payload: { action: "edit", id: "my-theme" } });
    expect(seen).toEqual([
      { action: "create" },
      { action: "edit", id: "my-theme" },
    ]);

    unlisten();
  });
});
