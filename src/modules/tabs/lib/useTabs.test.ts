import { describe, expect, it } from "vitest";
import { resolveTerminalWorkspaceUpdate, type TerminalTab } from "./useTabs";
import { type WorkspaceEnv } from "@/modules/workspace";

function terminalTab(workspace: WorkspaceEnv): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    title: "shell",
    workspace,
    workspaceNonce: 0,
    paneTree: { kind: "leaf", id: 2, cwd: "/Users/hsiangyu" },
    activeLeafId: 2,
  };
}

const local: WorkspaceEnv = { kind: "local" };
const sshA: WorkspaceEnv = {
  kind: "ssh",
  id: "ssh-1",
  label: "remote",
  host: "100.72.187.38",
  user: "sean",
  port: 22,
  rootPath: "/home/sean",
};

describe("resolveTerminalWorkspaceUpdate", () => {
  it("restarts on workspace identity change", () => {
    const next = resolveTerminalWorkspaceUpdate(terminalTab(local), sshA);
    expect(next.restartSession).toBe(true);
    expect(next.nextCwd).toBe("/home/sean");
  });

  it("does not restart when only SSH root path changes", () => {
    const next = resolveTerminalWorkspaceUpdate(terminalTab(sshA), {
      ...sshA,
      rootPath: "/home/sean/Github",
    });
    expect(next.restartSession).toBe(false);
    expect(next.nextCwd).toBe("/home/sean/Github");
  });

  it("honors an explicit restart request even when identity matches", () => {
    const next = resolveTerminalWorkspaceUpdate(terminalTab(sshA), sshA, {
      cwd: "/home/sean/Github",
      restartSession: true,
    });
    expect(next.restartSession).toBe(true);
    expect(next.nextCwd).toBe("/home/sean/Github");
  });
});
