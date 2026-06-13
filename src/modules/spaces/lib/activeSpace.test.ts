import { describe, expect, it } from "vitest";
import { activeSpaceEnv, findActiveSpace } from "./activeSpace";
import type { SpaceMeta } from "./store";

function space(over: Partial<SpaceMeta>): SpaceMeta {
  return {
    id: "s1",
    name: "Space",
    root: null,
    env: { kind: "local" },
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("findActiveSpace", () => {
  it("returns the space matching activeId", () => {
    const spaces = [space({ id: "a" }), space({ id: "b" })];
    expect(findActiveSpace(spaces, "b")?.id).toBe("b");
  });

  it("falls back to the first space when activeId is null or unknown", () => {
    const spaces = [space({ id: "a" }), space({ id: "b" })];
    expect(findActiveSpace(spaces, null)?.id).toBe("a");
    expect(findActiveSpace(spaces, "missing")?.id).toBe("a");
  });

  it("returns null when there are no spaces", () => {
    expect(findActiveSpace([], "a")).toBeNull();
  });
});

describe("activeSpaceEnv", () => {
  it("restores the active space's WSL env", () => {
    const spaces = [
      space({ id: "a", env: { kind: "local" } }),
      space({ id: "b", env: { kind: "wsl", distro: "Ubuntu" } }),
    ];
    expect(activeSpaceEnv(spaces, "b")).toEqual({
      kind: "wsl",
      distro: "Ubuntu",
    });
  });

  it("restores the env of the fallback space when activeId is missing", () => {
    const spaces = [space({ id: "a", env: { kind: "wsl", distro: "Debian" } })];
    expect(activeSpaceEnv(spaces, null)).toEqual({
      kind: "wsl",
      distro: "Debian",
    });
  });

  it("defaults to local when there are no spaces", () => {
    expect(activeSpaceEnv([], "a")).toEqual({ kind: "local" });
  });
});
