import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));
vi.mock("@/lib/platform", () => ({ IS_WINDOWS: false }));

import type { Completion } from "@codemirror/autocomplete";
import { pathCompletions } from "./pathComplete";

const CWD = "/work";

function entry(name: string, kind: "file" | "dir" = "file") {
  return { name, kind, size: 0, mtime: 0 };
}

function mockDir(entries: ReturnType<typeof entry>[]) {
  invoke.mockResolvedValue(entries);
}

async function complete(token: string) {
  const result = await pathCompletions(token, CWD);
  return result?.options ?? [];
}

beforeEach(() => vi.resetAllMocks());

describe("pathCompletions", () => {
  it("lists a spaced directory with its name escaped for the shell", async () => {
    mockDir([entry("My Folder", "dir")]);

    const options = await complete("My");

    expect(options).toHaveLength(1);
    expect(options[0].label).toBe("My\\ Folder/");
    expect(options[0].displayLabel).toBe("My Folder/");
  });

  it("escapes shell syntax so a name is one literal argument", async () => {
    mockDir([entry("$HOME & c.txt")]);

    const [option] = await complete("$");

    expect(option.label).toBe("\\$HOME\\ \\&\\ c.txt");
    expect(option.displayLabel).toBe("$HOME & c.txt");
  });

  it("leaves a plain name alone so the popup can highlight the match", async () => {
    mockDir([entry("notes.txt")]);

    const [option] = await complete("no");

    expect(option).toEqual({ label: "notes.txt", type: "variable" });
  });

  it("matches a prefix that was typed already escaped", async () => {
    mockDir([entry("My Folder", "dir")]);

    const options = await complete("My\\ Fol");

    expect(options.map((o) => o.label)).toEqual(["My\\ Folder/"]);
  });

  it("reads the directory a completed name actually points at", async () => {
    mockDir([entry("sub dir", "dir")]);

    await complete("My\\ Folder/sub");

    expect(invoke).toHaveBeenCalledWith(
      "fs_read_dir",
      expect.objectContaining({ path: "/work/My Folder" }),
    );
  });

  it("keeps completing inside a directory it just escaped", async () => {
    mockDir([entry("My Folder", "dir")]);
    const [dir] = await complete("My");
    mockDir([entry("notes file.txt")]);

    const options = await complete(dir.label);

    expect(invoke).toHaveBeenLastCalledWith(
      "fs_read_dir",
      expect.objectContaining({ path: "/work/My Folder" }),
    );
    expect(options.map((o) => o.label)).toEqual(["notes\\ file.txt"]);
  });

  it("inserts an escaped directory and reopens completion on accept", async () => {
    mockDir([entry("My Folder", "dir")]);
    const [option] = await complete("My");
    const view = { state: { field: () => ({}) }, dispatch: vi.fn() };

    (option.apply as (v: unknown, c: Completion, f: number, t: number) => void)(
      view,
      option,
      3,
      5,
    );

    expect(view.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { from: 3, to: 5, insert: "My\\ Folder/" },
      }),
    );
  });

  it("puts directories before files and caps the list", async () => {
    const many = Array.from({ length: 260 }, (_, i) => entry(`f${i}.txt`));
    mockDir([entry("a file.txt"), entry("a dir", "dir"), ...many]);

    const options = await complete("");

    expect(options.length).toBe(200);
    expect(options[0].label).toBe("a\\ dir/");
    expect(options[1].label).toBe("a\\ file.txt");
  });

  it("returns nothing when the directory cannot be read", async () => {
    invoke.mockRejectedValue(new Error("nope"));

    expect(await pathCompletions("x", CWD)).toBeNull();
  });

  it("leaves home expansion alone", async () => {
    expect(await pathCompletions("~/Doc", CWD)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
