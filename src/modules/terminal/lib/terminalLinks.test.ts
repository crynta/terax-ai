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
import { invoke } from "@tauri-apps/api/core";
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

const context = () => ({
  cwd: "/work/app",
  focus: vi.fn(),
  workspace: { kind: "local" as const },
  isCurrent: () => true,
});
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
  it.each(["file", "dir"] as const)(
    "discards a %s click if its owner changes during stat",
    async (kind) => {
      const { api, calls } = deps();
      let current = true;
      api.stat = async () => {
        current = false;
        return kind;
      };
      await activateTerminalLink(
        path("a.txt"),
        { ...context(), isCurrent: () => current },
        api,
      );
      expect(calls.openInEditor).not.toHaveBeenCalled();
      expect(calls.reveal).not.toHaveBeenCalled();
    },
  );

  it("does no filesystem work for an activation superseded during lazy loading", async () => {
    const { api } = deps();
    api.stat = vi.fn();
    await activateTerminalLink(
      path("a.txt"),
      { ...context(), isCurrent: () => false },
      api,
    );
    expect(api.stat).not.toHaveBeenCalled();
  });

  it("uses the captured WSL distro throughout canonicalization and re-stat", async () => {
    const ipc = vi.mocked(invoke);
    ipc.mockReset();
    ipc
      .mockResolvedValueOnce({ kind: "symlink" })
      .mockResolvedValueOnce("/home/me/target")
      .mockResolvedValueOnce({ kind: "file" });
    await activateTerminalLink(path("link"), {
      ...context(),
      cwd: "/home/me",
      workspace: { kind: "wsl", distro: "Ubuntu" },
    });
    expect(ipc).toHaveBeenCalledTimes(3);
    for (const [, args] of ipc.mock.calls)
      expect(args).toMatchObject({ workspace: { kind: "wsl", distro: "Ubuntu" } });
  });

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
    expect(calls.inform).toHaveBeenCalledWith(
      "File not found",
      "src/missing.ts",
    );
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
    expect(calls.inform).toHaveBeenCalledWith(
      "Remote file link ignored",
      "other",
    );
  });

  it.each([
    "file:///%2Fserver/share",
    "file:///%5Cserver/share",
    "file:///%5C%5Cserver%5Cshare",
    "file:///%2F%5Cserver/share",
    "file:///%5C%2Fserver/share",
    "file:///%5C%5C%3F%5CUNC%5Cserver%5Cshare",
    "file:///%5C%5C.%5Cpipe%5Cname",
    "file://localhost//server/share",
  ])(
    "never touches the filesystem for a decoded network/device URL (%s)",
    async (uri) => {
      const { api, calls } = deps();
      const stat = vi.spyOn(api, "stat");
      const canonicalize = vi.spyOn(api, "canonicalize");
      await activateTerminalLink(url(uri), context(), api);
      expect(stat).not.toHaveBeenCalled();
      expect(canonicalize).not.toHaveBeenCalled();
      expect(calls.openInEditor).not.toHaveBeenCalled();
      expect(calls.reveal).not.toHaveBeenCalled();
      expect(calls.openUrl).not.toHaveBeenCalled();
    },
  );

  it("passes the local-only restriction to both native filesystem commands", async () => {
    const native = vi.mocked(invoke);
    native.mockReset();
    native
      .mockResolvedValueOnce({ kind: "symlink" })
      .mockResolvedValueOnce("/tmp/target")
      .mockResolvedValueOnce({ kind: "file" });
    await activateTerminalLink(url("file:///tmp/link"), context());
    expect(native.mock.calls).toEqual([
      [
        "fs_stat",
        { path: "/tmp/link", workspace: { kind: "local" }, localOnly: true },
      ],
      [
        "fs_canonicalize",
        { path: "/tmp/link", workspace: { kind: "local" }, localOnly: true },
      ],
      [
        "fs_stat",
        { path: "/tmp/target", workspace: { kind: "local" }, localOnly: true },
      ],
    ]);
  });

  it("does not stat or open a network path returned from canonicalization", async () => {
    const { api, calls } = deps({ "/tmp/link": "symlink" });
    api.canonicalize = async () => "\\\\server\\share\\file";
    const stat = vi.spyOn(api, "stat");
    await activateTerminalLink(url("file:///tmp/link"), context(), api);
    expect(stat).toHaveBeenCalledExactlyOnceWith("/tmp/link", true);
    expect(calls.openInEditor).not.toHaveBeenCalled();
    expect(calls.reveal).not.toHaveBeenCalled();
  });

  it("opens the filesystem-resolved parent of a symlink rather than a lexical parent", async () => {
    const { api, calls } = deps({
      "/work/app/build/../main.ts": "file",
      "/external/main.ts": "file",
    });
    api.canonicalize = vi.fn(async () => "/external/main.ts");
    await activateTerminalLink(path("build/../main.ts", 12), context(), api);
    expect(api.canonicalize).toHaveBeenCalledWith(
      "/work/app/build/../main.ts",
      false,
    );
    expect(calls.openInEditor).toHaveBeenCalledWith("/external/main.ts", 12);
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
