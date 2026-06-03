import { describe, expect, it } from "vitest";
import { resolveExplorerRoot } from "./useWorkspaceCwd";
import type { Tab } from "./useTabs";

function terminalTab(cwd: string | undefined, workspaceRoot: string): Tab {
  return {
    id: 1,
    kind: "terminal",
    title: "shell",
    cwd,
    workspace: {
      kind: "ssh",
      id: "ssh-1",
      label: "remote",
      host: "100.72.187.38",
      user: "sean",
      port: 22,
      rootPath: workspaceRoot,
    },
    workspaceNonce: 0,
    paneTree: { kind: "leaf", id: 2, cwd },
    activeLeafId: 2,
  };
}

describe("resolveExplorerRoot", () => {
  it("prefers the active SSH tab cwd over the stored workspace root", () => {
    const tab = terminalTab("/home/sean/Github", "/Users/hsiangyu");
    expect(
      resolveExplorerRoot(tab, [tab], "/Users/hsiangyu", "/Users/hsiangyu", null),
    ).toBe("/home/sean/Github");
  });

  it("falls back to the SSH workspace root when cwd is not yet available", () => {
    const tab = terminalTab(undefined, "/home/sean");
    expect(
      resolveExplorerRoot(tab, [tab], "/Users/hsiangyu", null, null),
    ).toBe("/home/sean");
  });

  it("falls back to the workspace root when there is no active terminal cwd", () => {
    const tab = terminalTab(undefined, "/home/sean/Github");
    expect(
      resolveExplorerRoot(tab, [tab], "/Users/hsiangyu", "/home/sean/Github", null),
    ).toBe("/home/sean/Github");
  });
});
