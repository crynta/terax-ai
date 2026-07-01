import { describe, expect, it } from "vitest";
import { shellCompletionOptions } from "./composerShellCompletion";

describe("terminal composer shell completion", () => {
  it("suggests common commands and shell keywords", () => {
    expect(shellCompletionOptions("git").map((item) => item.label)).toContain(
      "git",
    );
    expect(shellCompletionOptions("expo").map((item) => item.label)).toContain(
      "export",
    );
  });

  it("adds useful words already present in the draft", () => {
    const labels = shellCompletionOptions("DEP", "export DEPLOY_TARGET=prod").map(
      (item) => item.label,
    );
    expect(labels).toContain("DEPLOY_TARGET");
  });
});
