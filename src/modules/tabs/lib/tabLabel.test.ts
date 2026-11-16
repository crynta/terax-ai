import { describe, expect, it } from "vitest";
import { labelFor, shellDisplayName } from "./tabLabel";
import type { TerminalTab } from "./useTabs";

const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";

function terminalTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "default",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
    ...over,
  };
}

describe("labelFor (terminal tabs)", () => {
  it("derives the label from the last cwd segment", () => {
    expect(labelFor(terminalTab({ cwd: "/Users/me/projects/terax-ai" }))).toBe(
      "terax-ai",
    );
  });

  it("falls back to the title when there is no cwd", () => {
    expect(labelFor(terminalTab({ title: "private" }))).toBe("private");
  });

  it("prefers a custom title over the cwd-derived name", () => {
    expect(
      labelFor(
        terminalTab({
          cwd: "/Users/me/projects/terax-ai",
          customTitle: "Server",
        }),
      ),
    ).toBe("Server");
  });

  it("keeps the custom title after the cwd changes (survives cd)", () => {
    const renamed = terminalTab({ cwd: "/Users/me/a", customTitle: "Server" });
    const afterCd = { ...renamed, cwd: "/Users/me/b/c" };
    expect(labelFor(afterCd)).toBe("Server");
  });

  it("handles Windows-style cwd separators", () => {
    expect(labelFor(terminalTab({ cwd: "C:\\Users\\me\\proj" }))).toBe("proj");
  });
});

describe("labelFor shell-name fallback", () => {
  it("shows the shell display name when the cwd resolves to the OSC username", () => {
    expect(
      labelFor(
        terminalTab({ title: "zhaid@HOSTNAME ~", cwd: "/c/Users/zhaid" }),
        GIT_BASH,
      ),
    ).toBe("Git Bash");
  });

  it("keeps the folder name when the shell is at a real project dir", () => {
    expect(
      labelFor(
        terminalTab({
          title: "zhaid@HOSTNAME /c/Users/zhaid/proj",
          cwd: "/c/Users/zhaid/proj",
        }),
        GIT_BASH,
      ),
    ).toBe("proj");
  });

  it("shows the shell name when the OSC title is missing and there is no cwd", () => {
    expect(labelFor(terminalTab({ title: "" }), GIT_BASH)).toBe("Git Bash");
  });

  it("keeps the raw OSC title when there is no cwd and no configured shell", () => {
    expect(labelFor(terminalTab({ title: "zhaid@HOSTNAME ~" }))).toBe(
      "zhaid@HOSTNAME ~",
    );
  });

  it("keeps a custom title over the shell name", () => {
    expect(
      labelFor(
        terminalTab({
          title: "zhaid@HOSTNAME ~",
          cwd: "/c/Users/zhaid",
          customTitle: "Server",
        }),
        GIT_BASH,
      ),
    ).toBe("Server");
  });

  it("falls back to the cwd name when the shell setting is unset (auto)", () => {
    expect(
      labelFor(
        terminalTab({ title: "zhaid@HOSTNAME ~", cwd: "/c/Users/zhaid" }),
      ),
    ).toBe("zhaid");
  });
});

describe("shellDisplayName", () => {
  it("maps known shells to display names", () => {
    expect(shellDisplayName("/usr/bin/zsh")).toBe("Zsh");
    expect(shellDisplayName("/usr/local/bin/fish")).toBe("Fish");
    expect(shellDisplayName("/usr/bin/bash")).toBe("Git Bash");
    expect(shellDisplayName("C:\\Windows\\System32\\cmd.exe")).toBe("Cmd");
    expect(shellDisplayName("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe(
      "PowerShell",
    );
    expect(
      shellDisplayName(
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ),
    ).toBe("PowerShell");
  });

  it("returns the filename stem for unknown shells", () => {
    expect(shellDisplayName("/usr/bin/nu")).toBe("nu");
    expect(shellDisplayName("C:\\nix\\elvish.exe")).toBe("elvish");
  });

  it("returns empty when the shell setting is unset or empty", () => {
    expect(shellDisplayName("")).toBe("");
    expect(shellDisplayName(undefined)).toBe("");
  });
});
