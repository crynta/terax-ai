import { describe, expect, it } from "vitest";
import { workspaceRootForAi } from "./useAiLiveBridge";

describe("workspaceRootForAi", () => {
  it("returns null for a rootless Space despite populated legacy fallbacks", () => {
    expect(
      workspaceRootForAi({
        explorerRoot: null,
        launchCwd: "/launch-cwd",
        home: "/home",
      }),
    ).toBeNull();
  });

  it("returns the usable active Space root", () => {
    expect(workspaceRootForAi({ explorerRoot: "/space-root" })).toBe(
      "/space-root",
    );
  });
});
