import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => core);

const workspace = vi.hoisted(() => ({
  currentWorkspaceEnv: vi.fn(() => "local"),
}));

vi.mock("@/modules/workspace", () => workspace);

const cm = vi.hoisted(() => ({
  startCompletion: vi.fn(),
}));

vi.mock("@codemirror/autocomplete", () => cm);

import { pathCompletions } from "./pathComplete";

type InvokeArgs = { path: string; showHidden: boolean; workspace: string };

function entry(
  name: string,
  kind: "file" | "dir" | "symlink" = "file",
): { name: string; kind: string; size: number; mtime: number } {
  return { name, kind, size: 0, mtime: 0 };
}

function fakeView() {
  return { dispatch: vi.fn() };
}

describe("block-mode path completion", () => {
  beforeEach(() => {
    core.invoke.mockReset();
    cm.startCompletion.mockClear();
  });

  it("lists a bare token against cwd with dirs before files", async () => {
    core.invoke.mockResolvedValue([
      entry("README.md"),
      entry("src", "dir"),
      entry("package.json"),
    ]);

    const res = await pathCompletions("", "/repo");

    expect(core.invoke).toHaveBeenCalledWith("fs_read_dir", {
      path: "/repo",
      showHidden: false,
      workspace: "local",
    } satisfies InvokeArgs);
    expect(res?.fromOffset).toBe(0);
    expect(res?.options.map((o) => o.label)).toEqual([
      "src/",
      "README.md",
      "package.json",
    ]);
    expect(res?.options.map((o) => o.type)).toEqual([
      "type",
      "variable",
      "variable",
    ]);
  });

  it("splits the token at the last slash and reports the dir part as fromOffset", async () => {
    core.invoke.mockResolvedValue([entry("main.ts")]);

    const res = await pathCompletions("lib/ma", "/repo");

    expect(core.invoke).toHaveBeenCalledWith("fs_read_dir", {
      path: "/repo/lib",
      showHidden: false,
      workspace: "local",
    } satisfies InvokeArgs);
    expect(res?.fromOffset).toBe(4);
    expect(res?.options.map((o) => o.label)).toEqual(["main.ts"]);
  });

  it("uses an absolute dir part as-is", async () => {
    core.invoke.mockResolvedValue([]);

    const res = await pathCompletions("/etc/ngi", "/repo");

    expect(core.invoke).toHaveBeenCalledWith("fs_read_dir", {
      path: "/etc/",
      showHidden: false,
      workspace: "local",
    } satisfies InvokeArgs);
    expect(res).toEqual({ fromOffset: 5, options: [] });
  });

  it("refuses home-relative tokens without touching the backend", async () => {
    const res = await pathCompletions("~/.ssh/id", "/repo");

    expect(res).toBeNull();
    expect(core.invoke).not.toHaveBeenCalled();
  });

  it("requests hidden entries only when the base starts with a dot", async () => {
    core.invoke.mockResolvedValue([]);

    await pathCompletions(".", "/repo");
    await pathCompletions("normal", "/repo");

    const calls = core.invoke.mock.calls.map((c) => c[1] as InvokeArgs);
    expect(calls[0].showHidden).toBe(true);
    expect(calls[1].showHidden).toBe(false);
  });

  it("filters case-insensitively on the base prefix", async () => {
    core.invoke.mockResolvedValue([
      entry("Src", "dir"),
      entry("readme.md"),
      entry("node_modules", "dir"),
    ]);

    const res = await pathCompletions("re", "/repo");

    expect(res?.options.map((o) => o.label)).toEqual(["readme.md"]);
  });

  it("treats symlinks as files", async () => {
    core.invoke.mockResolvedValue([entry("link", "symlink")]);

    const res = await pathCompletions("", "/repo");

    expect(res?.options.map((o) => o.label)).toEqual(["link"]);
  });

  it("dir applies insert the trailing slash and retrigger completion", async () => {
    core.invoke.mockResolvedValue([entry("src", "dir")]);

    const res = await pathCompletions("", "/repo");
    const dir = res?.options[0];
    if (typeof dir?.apply !== "function")
      throw new Error("dir completion missing apply");

    const view = fakeView();
    dir.apply(view as never, dir, 3, 5);

    expect(view.dispatch).toHaveBeenCalledWith({
      changes: { from: 3, to: 5, insert: "src/" },
      selection: { anchor: 7 },
    });
    expect(cm.startCompletion).toHaveBeenCalledWith(view);
  });

  it("caps the option list at 200 entries", async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      entry(`f${String(i).padStart(3, "0")}.txt`),
    );
    core.invoke.mockResolvedValue(many);

    const res = await pathCompletions("", "/repo");

    expect(res?.options).toHaveLength(200);
  });

  it("normalizes backslash tokens and drive-absolute paths on windows", async () => {
    core.invoke.mockResolvedValue([
      { name: "main.ts", kind: "file", size: 0, mtime: 0 },
    ]);

    const res = await pathCompletions("lib\\ma", "C:/repo");

    expect(core.invoke).toHaveBeenCalledWith("fs_read_dir", {
      path: "C:/repo/lib",
      showHidden: false,
      workspace: "local",
    } satisfies InvokeArgs);
    expect(res?.fromOffset).toBe(4);
    expect(res?.options.map((o) => o.label)).toEqual(["main.ts"]);

    const abs = await pathCompletions("C:\\repo\\lib\\ma", "C:/repo");
    expect(core.invoke).toHaveBeenLastCalledWith("fs_read_dir", {
      path: "C:/repo/lib/",
      showHidden: false,
      workspace: "local",
    } satisfies InvokeArgs);
    expect(abs?.fromOffset).toBe(12);
    expect(abs?.options.map((o) => o.label)).toEqual(["main.ts"]);
  });

  it("returns null when the backend rejects the read", async () => {
    core.invoke.mockRejectedValue(new Error("denied"));

    const res = await pathCompletions("", "/repo");

    expect(res).toBeNull();
  });
});
