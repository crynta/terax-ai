import { beforeEach, expect, it, vi } from "vitest";
import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
const { invoke, workspace } = vi.hoisted(() => ({
  invoke: vi.fn(),
  workspace: { kind: "local" },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => workspace,
}));
vi.mock("@/lib/platform", () => ({ IS_WINDOWS: false }));
import { makeCompletionSource } from "./shellEditor";

function context(doc: string, pos = doc.length, explicit = true) {
  return new CompletionContext(EditorState.create({ doc }), pos, explicit);
}
function apply(doc: string, option: Completion, from: number, to: number) {
  let insert = option.apply;
  if (typeof insert !== "string") {
    const view = { state: { field: () => ({}) }, dispatch: vi.fn() };
    (insert as (v: unknown, c: Completion, f: number, t: number) => void)(
      view,
      option,
      from,
      to,
    );
    insert = view.dispatch.mock.calls[0][0].changes.insert;
  }
  return doc.slice(0, from) + insert + doc.slice(to);
}
beforeEach(() => {
  vi.resetAllMocks();
});
it.each(['cat "My', "cat 'My", "cat My\\ F"])(
  "completes %s to a valid unquoted argument",
  async (doc) => {
    invoke.mockResolvedValue([{ name: "My Folder", kind: "dir" }]);
    const result = required(
      await makeCompletionSource(
        () => [],
        () => "/work",
      )(context(doc)),
    );
    expect(
      apply(doc, result.options[0], result.from, required(result.to)),
    ).toBe("cat My\\ Folder/");
  },
);
it("replaces a closing quote after the cursor without touching the next argument", async () => {
  invoke.mockResolvedValue([{ name: "My Folder", kind: "file" }]);
  const doc = 'cat "My" next';
  const result = required(
    await makeCompletionSource(
      () => [],
      () => "/work",
    )(context(doc, 7)),
  );
  expect(apply(doc, result.options[0], result.from, required(result.to))).toBe(
    "cat My\\ Folder next",
  );
});
it("refreshes completions when a space starts another argument", async () => {
  invoke.mockResolvedValue([{ name: "My Folder", kind: "file" }]);
  const result = required(
    await makeCompletionSource(
      () => [],
      () => "/work",
    )(context("cat My")),
  );
  expect(required(result.update)(result, 4, 7, context("cat My "))).toBeNull();
});
it.each(["cat $HOME/", 'cat "My$HOME"'])(
  "does not replace expansions before or after the cursor: %s",
  async (doc) => {
    const pos = doc.includes("My") ? 7 : doc.length;
    expect(
      await makeCompletionSource(
        () => [],
        () => "/work",
      )(context(doc, pos)),
    ).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  },
);
it("retains command completion after separators", async () => {
  const result = required(
    await makeCompletionSource(
      () => ["cat"],
      () => "/work",
    )(context("echo hi; ca")),
  );
  expect(result.options).toContainEqual({ label: "cat", type: "function" });
  expect(invoke).not.toHaveBeenCalled();
});
it("invalidates completion after the terminal changes its cwd", async () => {
  let cwd = "/work";
  invoke.mockResolvedValue([{ name: "My Folder", kind: "file" }]);
  const source = makeCompletionSource(
    () => [],
    () => cwd,
  );
  const result = required(await source(context("cat My")));
  cwd = "/elsewhere";
  expect(required(result.update)(result, 4, 6, context("cat MyF"))).toBeNull();
  invoke.mockImplementation(async () => {
    cwd = "/work";
    return [{ name: "My Folder", kind: "file" }];
  });
  expect(await source(context("cat My"))).toBeNull();
});

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected a completion result");
  return value;
}
