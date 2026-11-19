import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";

const { invoke, platform, workspace } = vi.hoisted(() => ({
  invoke: vi.fn(),
  platform: { IS_WINDOWS: false },
  workspace: {
    env: { kind: "local" } as
      | { kind: "local" }
      | { kind: "wsl"; distro: string },
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => workspace.env,
}));
vi.mock("@/lib/platform", () => ({
  get IS_WINDOWS() {
    return platform.IS_WINDOWS;
  },
}));
import { pathCompletionResult, pathCompletions } from "./pathComplete";
import { shellWordAt } from "./shellWord";

function entry(name: string, kind = "file") {
  return { name, kind };
}
function inserted(option: Completion) {
  if (typeof option.apply === "string") return option.apply;
  const view = { state: { field: () => ({}) }, dispatch: vi.fn() };
  (option.apply as (v: unknown, c: Completion, f: number, t: number) => void)(
    view,
    option,
    3,
    8,
  );
  return view.dispatch.mock.calls[0][0].changes.insert;
}
beforeEach(() => {
  vi.resetAllMocks();
  platform.IS_WINDOWS = false;
  workspace.env = { kind: "local" };
});

describe("path completion", () => {
  it.each([
    ["My", "My Folder", "My\\ Folder/"],
    ["My\\ Fol", "My Folder", "My\\ Folder/"],
    ['"My Fol', "My Folder", "My\\ Folder/"],
    ["'My Fol'", "My Folder", "My\\ Folder/"],
    ["\\$", "$HOME & c", "\\$HOME\\ \\&\\ c/"],
    ["caf", "café", "café/"],
    ["\\~", "~name", "\\~name/"],
    ["\\=", "=ls", "\\=ls/"],
  ])(
    "inserts a literal whole argument for %s",
    async (token, name, escaped) => {
      invoke.mockResolvedValue([entry(name, "dir")]);
      const result = await pathCompletions(token, "/work");
      expect(required(result).options.map((o) => o.label)).toEqual([
        `${name}/`,
      ]);
      expect(inserted(required(result).options[0])).toBe(escaped);
    },
  );

  it.each([
    "My\\ Folder/no",
    "'My Folder/no",
    '"My Folder/no"',
    "'My Folder'/no",
  ])("decodes quotes spanning a directory in %s", async (token) => {
    invoke.mockResolvedValue([entry("notes file.txt")]);
    const result = await pathCompletions(token, "/work");
    expect(invoke).toHaveBeenCalledWith("fs_read_dir", {
      path: "/work/My Folder/",
      showHidden: false,
      workspace: workspace.env,
    });
    expect(inserted(required(result).options[0])).toBe(
      "My\\ Folder/notes\\ file.txt",
    );
  });

  it("keeps completing inside the argument it just inserted", async () => {
    invoke.mockResolvedValueOnce([entry("My Folder", "dir")]);
    const first = await pathCompletions("My", "/work");
    invoke.mockResolvedValueOnce([entry("notes file.txt")]);
    const second = await pathCompletions(
      inserted(required(first).options[0]),
      "/work",
    );
    expect(inserted(required(second).options[0])).toBe(
      "My\\ Folder/notes\\ file.txt",
    );
  });

  it("returns directories first and caps the retained candidates", async () => {
    invoke.mockResolvedValue([
      entry("a file"),
      entry("a dir", "dir"),
      ...Array.from({ length: 260 }, (_, i) => entry(`f${i}`)),
    ]);
    const result = await pathCompletions("", "/work");
    expect(required(result).options).toHaveLength(200);
    expect(required(result).options[0].label).toBe("a dir/");
    expect(required(result).update("f2")).toBeNull();
  });

  it("refilters cached entries without filesystem calls and refreshes when the context changes", async () => {
    invoke.mockResolvedValue([entry("My Folder"), entry("My File")]);
    const result = await pathCompletions("My", "/work");
    expect(
      required(required(result).update('"My Fol')).options.map((o) => o.label),
    ).toEqual(["My Folder"]);
    for (const token of ["M", "My Folder/", ".", "$HOME", "My next"])
      expect(required(result).update(token)).toBeNull();
    workspace.env = { kind: "wsl", distro: "Ubuntu" };
    expect(required(result).update("My F")).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not expose stale results after a workspace switch during the read", async () => {
    invoke.mockImplementation(async () => {
      workspace.env = { kind: "wsl", distro: "Ubuntu" };
      return [entry("file")];
    });
    expect(await pathCompletions("f", "/work")).toBeNull();
  });

  it.each(["~/Doc", "$HOME/Doc", "$(pwd)/Doc", "*.txt", "`pwd`/", "a\\"])(
    "leaves expansion or unfinished escapes alone: %s",
    async (token) => {
      expect(await pathCompletions(token, "/work")).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("returns nothing when the directory cannot be read", async () => {
    invoke.mockRejectedValue(new Error("unreadable"));
    expect(await pathCompletions("x", "/work")).toBeNull();
  });

  it("includes hidden files for a quoted dot prefix", async () => {
    invoke.mockResolvedValue([entry(".git", "dir")]);
    await pathCompletions("'.g", "/work");
    expect(invoke.mock.calls[0][1].showHidden).toBe(true);
  });

  it("replaces a whole quoted argument and refilters with CodeMirror's update contract", async () => {
    invoke.mockResolvedValue([entry("My Folder"), entry("My File")]);
    const doc = 'cat "My" next';
    const word = shellWordAt(doc, 7, false);
    const result = pathCompletionResult(
      word,
      required(await pathCompletions(word.text, "/work")),
      false,
    );
    const option = result.options[0];
    expect(
      doc.slice(0, result.from) + inserted(option) + doc.slice(result.to),
    ).toBe("cat My\\ Folder next");
    expect(result.filter).toBe(false);
    const nextDoc = 'cat "My Fol" next';
    const ctx = new CompletionContext(
      EditorState.create({ doc: nextDoc }),
      11,
      false,
    );
    const updated = required(
      required(result.update)(result, result.from, 12, ctx),
    );
    expect(updated.options.map((o) => o.label)).toEqual(["My Folder"]);
    expect(required(updated.getMatch)(updated.options[0])).toEqual([0, 6]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("Windows and WSL", () => {
  beforeEach(() => {
    platform.IS_WINDOWS = true;
  });
  it.each([
    "'My Folder/no",
    '"My Folder/no"',
    "My Folder/no",
    "'My Folder'/no",
  ])("inserts one PowerShell literal for %s", async (token) => {
    if (token === "My Folder/no") token = "My` Folder/no";
    invoke.mockResolvedValue([entry("notes file.txt")]);
    const result = await pathCompletions(token, "C:/work");
    expect(inserted(required(result).options[0])).toBe(
      "'My Folder/notes file.txt'",
    );
    expect(invoke.mock.calls[0][1].path).toBe("C:/work/My Folder/");
  });
  it.each(["C:\\work\\My", "C:/work/My", "'C:/work/My"])(
    "recognizes drive paths in %s",
    async (token) => {
      invoke.mockResolvedValue([entry("My Folder", "dir")]);
      const result = await pathCompletions(token, "D:/elsewhere");
      expect(invoke.mock.calls[0][1].path).toBe("C:/work/");
      expect(inserted(required(result).options[0])).toBe(
        "'C:/work/My Folder/'",
      );
    },
  );
  it("recognizes UNC paths", async () => {
    invoke.mockResolvedValue([entry("file")]);
    await pathCompletions("\\\\server\\share\\fi", "C:/work");
    expect(invoke.mock.calls[0][1].path).toBe("//server/share/");
  });
  it("uses POSIX escapes and preserves literal backslashes in WSL", async () => {
    workspace.env = { kind: "wsl", distro: "Ubuntu" };
    invoke.mockResolvedValue([entry("it's here", "dir")]);
    const result = await pathCompletions("My\\ Folder/a\\\\b/it", "/work");
    expect(invoke.mock.calls[0][1].path).toBe("/work/My Folder/a\\b/");
    expect(inserted(required(result).options[0])).toBe(
      "My\\ Folder/a\\\\b/it\\'s\\ here/",
    );
  });
});

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected a completion result");
  return value;
}
