import { describe, expect, it } from "vitest";
import { shellLabel } from "./shellLabel";

describe("shellLabel", () => {
  it("maps pwsh.exe to PowerShell", () => {
    expect(shellLabel("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe("PowerShell");
  });

  it("maps powershell.exe to PowerShell", () => {
    expect(shellLabel("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe("PowerShell");
  });

  it("maps bash to Bash", () => {
    expect(shellLabel("/usr/bin/bash")).toBe("Bash");
  });

  it("maps Git Bash bash.exe to Bash", () => {
    expect(shellLabel("C:\\Program Files\\Git\\bin\\bash.exe")).toBe("Bash");
  });

  it("maps zsh to Zsh", () => {
    expect(shellLabel("/usr/bin/zsh")).toBe("Zsh");
  });

  it("maps fish to Fish", () => {
    expect(shellLabel("/usr/local/bin/fish")).toBe("Fish");
  });

  it("maps cmd.exe to Command Prompt", () => {
    expect(shellLabel("C:\\Windows\\System32\\cmd.exe")).toBe("Command Prompt");
  });

  it("falls back to basename for unknown shells", () => {
    expect(shellLabel("/usr/bin/ksh")).toBe("Ksh");
  });

  it("returns Terminal for empty input", () => {
    expect(shellLabel("")).toBe("Terminal");
  });

  it("returns Terminal for null input", () => {
    expect(shellLabel(null)).toBe("Terminal");
  });

  it("returns Terminal for undefined input", () => {
    expect(shellLabel(undefined)).toBe("Terminal");
  });
});
