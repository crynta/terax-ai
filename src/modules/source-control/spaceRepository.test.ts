import { describe, expect, it } from "vitest";
import { sourceControlPathForSpace } from "./spaceRepository";

describe("sourceControlPathForSpace", () => {
  it("uses only the active Space root", () => {
    expect(sourceControlPathForSpace("/repo/packages/app", undefined)).toBe(
      "/repo/packages/app",
    );
  });

  it("changes context when the active Space changes", () => {
    expect(sourceControlPathForSpace("/repo-b", undefined)).toBe("/repo-b");
  });

  it("does not retarget from an active file or terminal cwd outside the Space", () => {
    const activeSpaceRoot = "/repo";
    const activeFileOutsideSpace = "/other/file.ts";
    const terminalCwdOutsideSpace = "/other";

    expect(activeFileOutsideSpace).not.toBe(activeSpaceRoot);
    expect(terminalCwdOutsideSpace).not.toBe(activeSpaceRoot);
    expect(sourceControlPathForSpace(activeSpaceRoot, undefined)).toBe(
      activeSpaceRoot,
    );
  });

  it("passes a nested Space root through for Git repository discovery", () => {
    expect(sourceControlPathForSpace("/repo/packages/app", undefined)).toBe(
      "/repo/packages/app",
    );
  });

  it("pauses Source Control for an unavailable root", () => {
    expect(
      sourceControlPathForSpace("/missing", {
        candidate: "/missing",
        message: "not found",
      }),
    ).toBeNull();
  });

  it("does not derive a context when no usable Space root exists", () => {
    expect(sourceControlPathForSpace(null, undefined)).toBeNull();
  });
});
