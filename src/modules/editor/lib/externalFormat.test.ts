import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => core);

vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => "local",
}));

import {
  applyFormattedContent,
  readFileText,
  resolveFormatter,
  runExternalFormatter,
} from "./externalFormat";

const prefs = (
  global: Parameters<typeof resolveFormatter>[1]["editorFormatter"],
  byLang: Record<string, never> | Record<string, "ruff" | "prettier"> = {},
) => ({ editorFormatter: global, editorFormatterByLang: byLang });

describe("resolveFormatter", () => {
  it("explicit override wins over the global default", () => {
    expect(resolveFormatter("py", prefs("biome", { py: "ruff" }))).toBe("ruff");
  });

  it("global external applies only to languages it understands", () => {
    expect(resolveFormatter("ts", prefs("biome"))).toBe("biome");
    expect(resolveFormatter("py", prefs("biome"))).toBe("lsp");
    expect(resolveFormatter("rs", prefs("prettier"))).toBe("lsp");
    expect(resolveFormatter("svelte", prefs("prettier"))).toBe("prettier");
  });

  it("lsp and custom globals always apply", () => {
    expect(resolveFormatter("py", prefs("lsp"))).toBe("lsp");
    expect(resolveFormatter("py", prefs("custom"))).toBe("custom");
  });

  it("unknown language falls back to lsp for external globals", () => {
    expect(resolveFormatter(null, prefs("biome"))).toBe("lsp");
  });
});

describe("runExternalFormatter", () => {
  beforeEach(() => {
    core.invoke.mockReset();
  });

  it("builds the tool command and runs it in the file's directory", async () => {
    core.invoke.mockResolvedValue({
      stdout: "",
      stderr: "",
      exit_code: 0,
      timed_out: false,
    });

    await expect(runExternalFormatter("rustfmt", "/repo/src/a.rs")).resolves.toBeNull();

    expect(core.invoke).toHaveBeenCalledWith(
      "shell_run_command",
      expect.objectContaining({
        command: "rustfmt --edition 2021 '/repo/src/a.rs'",
        cwd: "/repo/src",
        timeoutSecs: 20,
        workspace: "local",
      }),
    );
  });

  it("reports a timeout and a failing stderr tail", async () => {
    core.invoke.mockResolvedValueOnce({
      stdout: "",
      stderr: "",
      exit_code: null,
      timed_out: true,
    });
    await expect(runExternalFormatter("biome", "/a.ts")).resolves.toBe(
      "biome timed out",
    );

    core.invoke.mockResolvedValueOnce({
      stdout: "",
      stderr: "x".repeat(400),
      exit_code: 1,
      timed_out: false,
    });
    const err = await runExternalFormatter("biome", "/a.ts");
    expect(err).toBe("x".repeat(300));
  });

  it("falls back to a generic failure when stderr is empty", async () => {
    core.invoke.mockResolvedValueOnce({
      stdout: "",
      stderr: "  ",
      exit_code: 2,
      timed_out: false,
    });

    await expect(runExternalFormatter("gofmt", "/a.go")).resolves.toBe(
      "gofmt failed",
    );
  });

  it("refuses custom formatting without a configured template", async () => {
    await expect(runExternalFormatter("custom", "/a.ts", "   ")).resolves.toBe(
      "No custom format command configured in Settings.",
    );
    expect(core.invoke).not.toHaveBeenCalled();
  });

  it("substitutes {file} in custom templates or appends the path", async () => {
    core.invoke.mockResolvedValue({
      stdout: "",
      stderr: "",
      exit_code: 0,
      timed_out: false,
    });

    await runExternalFormatter("custom", "/dir/my file.ts", "prettier --write {file}");
    expect(core.invoke).toHaveBeenLastCalledWith(
      "shell_run_command",
      expect.objectContaining({ command: "prettier --write '/dir/my file.ts'" }),
    );

    await runExternalFormatter("custom", "/dir/b.ts", "npx fmt");
    expect(core.invoke).toHaveBeenLastCalledWith(
      "shell_run_command",
      expect.objectContaining({ command: "npx fmt '/dir/b.ts'" }),
    );
  });

  it("stringifies backend failures", async () => {
    core.invoke.mockRejectedValueOnce(new Error("spawn gone"));

    await expect(runExternalFormatter("shfmt", "/a.sh")).resolves.toBe(
      "Error: spawn gone",
    );
  });
});

describe("readFileText", () => {
  beforeEach(() => {
    core.invoke.mockReset();
  });

  it("returns text and mtime for text reads", async () => {
    core.invoke.mockResolvedValueOnce({
      kind: "text",
      content: "body",
      mtime: 123,
    });

    await expect(readFileText("/a.ts")).resolves.toEqual({
      text: "body",
      mtime: 123,
    });
  });

  it("maps binary, missing-content, and failed reads to null", async () => {
    core.invoke.mockResolvedValueOnce({ kind: "binary" });
    await expect(readFileText("/a.png")).resolves.toBeNull();

    core.invoke.mockResolvedValueOnce({ kind: "text", content: null });
    await expect(readFileText("/a.ts")).resolves.toBeNull();

    core.invoke.mockRejectedValueOnce(new Error("denied"));
    await expect(readFileText("/etc/shadow")).resolves.toBeNull();
  });
});

describe("applyFormattedContent", () => {
  function fakeView(current: string) {
    return {
      state: { doc: { toString: () => current } },
      dispatch: vi.fn(),
    };
  }

  it("does nothing when content is unchanged", () => {
    const view = fakeView("same");
    applyFormattedContent(view as never, "same");
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("dispatches only the changed middle span, keeping both ends intact", () => {
    const view = fakeView("hello world");
    applyFormattedContent(view as never, "hello brave world");

    expect(view.dispatch).toHaveBeenCalledWith({
      changes: { from: 6, to: 6, insert: "brave " },
    });
  });

  it("handles pure appends and pure deletions", () => {
    const appendView = fakeView("ab");
    applyFormattedContent(appendView as never, "abc");
    expect(appendView.dispatch).toHaveBeenCalledWith({
      changes: { from: 2, to: 2, insert: "c" },
    });

    const deleteView = fakeView("abc");
    applyFormattedContent(deleteView as never, "ac");
    expect(deleteView.dispatch).toHaveBeenCalledWith({
      changes: { from: 1, to: 2, insert: "" },
    });
  });
});
