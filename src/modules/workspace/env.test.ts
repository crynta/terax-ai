import { describe, expect, it } from "vitest";
import { sameWorkspaceEnv, workspaceScopeKey, type WorkspaceEnv } from "./env";

function sshEnv(rootPath: string): WorkspaceEnv {
  return {
    kind: "ssh",
    id: "ssh-1",
    label: "remote",
    host: "100.72.187.38",
    user: "sean",
    port: 22,
    rootPath,
  };
}

describe("workspace env identity", () => {
  it("ignores SSH root path when comparing workspace identity", () => {
    expect(sameWorkspaceEnv(sshEnv("/home/sean"), sshEnv("/home/sean/Github"))).toBe(
      true,
    );
  });

  it("keeps SSH scope stable across cwd changes", () => {
    expect(workspaceScopeKey(sshEnv("/home/sean"))).toBe(
      "ssh:sean@100.72.187.38:22",
    );
    expect(workspaceScopeKey(sshEnv("/home/sean/Github"))).toBe(
      "ssh:sean@100.72.187.38:22",
    );
  });
});

