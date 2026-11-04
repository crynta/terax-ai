import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-os", () => ({ hostname: vi.fn() }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/modules/lsp/lib/navigator", () => ({ getLspNavigator: vi.fn() }));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
  getWslHome: vi.fn(),
}));

import type { TerminalLinkHit } from "@/modules/terminal/ghostty/core/terminalLinks";
import { activateTerminalLink, type LinkActivationDeps } from "./terminalLinks";

function deps(files: Record<string, "file" | "dir" | "symlink"> = {}) {
  const calls = {
    openUrl: vi.fn(async (_url: string, focus: () => void) => focus()),
    openInEditor: vi.fn(),
    reveal: vi.fn(async () => {}),
    inform: vi.fn(),
    confirm: vi.fn(),
  };
  const api: LinkActivationDeps = {
    openUrl: calls.openUrl,
    stat: async (path) => files[path] ?? null,
    canonicalize: async (path) => path,
    home: async () => "/Users/me",
    hostname: async () => "box",
    openInEditor: calls.openInEditor,
    reveal: calls.reveal,
    inform: calls.inform,
    confirm: calls.confirm,
  };
  return { api, calls };
}

const context = () => ({ cwd: "/work/app", focus: vi.fn() });
const url = (uri: string, text = uri): TerminalLinkHit => ({
  kind: "osc8",
  uri,
  text,
  segments: [],
});
const path = (raw: string, line?: number): TerminalLinkHit => ({
  kind: "path",
  uri: raw,
  text: raw,
  segments: [],
  path: raw,
  line,
});

describe("activateTerminalLink", () => {
  it("opens web links natively and restores terminal focus", async () => {
    const { api, calls } = deps();
    const ctx = context();
    await activateTerminalLink(url("https://example.com/a"), ctx, api);
    expect(calls.openUrl).toHaveBeenCalledWith(
      "https://example.com/a",
      ctx.focus,
    );
    expect(ctx.focus).toHaveBeenCalledOnce();
  });

  it("asks before opening a link that disguises its destination", async () => {
    const { api, calls } = deps();
    await activateTerminalLink(
      url("https://evil.test/", "paypal.com"),
      context(),
      api,
    );
    expect(calls.openUrl).not.toHaveBeenCalled();
    expect(calls.confirm).toHaveBeenCalledOnce();
    calls.confirm.mock.calls[0][0].onConfirm();
    expect(calls.openUrl).toHaveBeenCalledWith(
      "https://evil.test/",
      expect.any(Function),
    );
  });

  it("never opens script or app schemes", async () => {
    const { api, calls } = deps();
    await activateTerminalLink(url("javascript:alert(1)"), context(), api);
    await activateTerminalLink(url("vscode://file/etc/passwd"), context(), api);
    expect(calls.openUrl).not.toHaveBeenCalled();
    expect(calls.confirm).not.toHaveBeenCalled();
    expect(calls.inform).toHaveBeenCalledTimes(2);
  });

  it("opens an existing file in the editor at its line", async () => {
    const { api, calls } = deps({ "/work/app/src/a.ts": "file" });
    await activateTerminalLink(path("src/a.ts", 12), context(), api);
    expect(calls.openInEditor).toHaveBeenCalledWith("/work/app/src/a.ts", 12);
  });

  it("says so instead of opening a path that does not exist", async () => {
    const { api, calls } = deps();
    await activateTerminalLink(path("src/missing.ts", 3), context(), api);
    expect(calls.openInEditor).not.toHaveBeenCalled();
    expect(calls.inform).toHaveBeenCalledWith("File not found", "src/missing.ts");
  });

  it("falls back to the git diff path without its a/ prefix", async () => {
    const { api, calls } = deps({ "/work/app/src/x.ts": "file" });
    await activateTerminalLink(path("a/src/x.ts"), context(), api);
    expect(calls.openInEditor).toHaveBeenCalledWith("/work/app/src/x.ts", 1);
  });

  it("reveals a directory instead of editing it", async () => {
    const { api, calls } = deps({ "/Users/me/projects": "dir" });
    await activateTerminalLink(path("~/projects"), context(), api);
    expect(calls.reveal).toHaveBeenCalledWith("/Users/me/projects");
    expect(calls.openInEditor).not.toHaveBeenCalled();
  });

  it("opens local file URLs and ignores another machine's", async () => {
    const { api, calls } = deps({ "/tmp/a.txt": "file" });
    await activateTerminalLink(url("file:///tmp/a.txt"), context(), api);
    expect(calls.openInEditor).toHaveBeenCalledWith("/tmp/a.txt", 1);
    await activateTerminalLink(url("file://other/tmp/a.txt"), context(), api);
    expect(calls.openInEditor).toHaveBeenCalledTimes(1);
    expect(calls.inform).toHaveBeenCalledWith("Remote file link ignored", "other");
  });

  it("restores focus and does not throw when opening fails", async () => {
    const { api } = deps();
    api.openUrl = async () => {
      throw new Error("boom");
    };
    const ctx = context();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      activateTerminalLink(url("https://example.com/"), ctx, api),
    ).resolves.toBeUndefined();
    expect(ctx.focus).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
