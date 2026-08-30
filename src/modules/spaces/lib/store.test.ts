import { describe, expect, it } from "vitest";
import { normalizeSpaceEnvs, type RawSpaceMeta, type SpaceMeta } from "./store";

function space(overrides: Partial<SpaceMeta>): SpaceMeta {
  return {
    id: "space",
    name: "Space",
    root: null,
    env: { kind: "local" },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("normalizeSpaceEnvs", () => {
  it("supplies the fallback only for absent or invalid persisted environments", () => {
    const fallback = { kind: "wsl", distro: "Ubuntu" } as const;
    const legacy: RawSpaceMeta = {
      id: "legacy",
      name: "Legacy",
      root: null,
      createdAt: 0,
      updatedAt: 0,
    };
    const invalid: RawSpaceMeta = {
      ...legacy,
      id: "invalid",
      env: { kind: "wsl" },
    };

    expect(normalizeSpaceEnvs([legacy, invalid], fallback)).toEqual([
      { ...legacy, env: fallback },
      { ...invalid, env: fallback },
    ]);
  });

  it("preserves a valid persisted environment", () => {
    const persisted = space({ env: { kind: "local" } });

    const [normalized] = normalizeSpaceEnvs([persisted], {
      kind: "wsl",
      distro: "Ubuntu",
    });

    expect(normalized).toBe(persisted);
    expect(normalized.env).toEqual({ kind: "local" });
  });
});
