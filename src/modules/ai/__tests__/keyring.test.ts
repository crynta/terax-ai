import { describe, it, expect } from "vitest";
import { EMPTY_PROVIDER_KEYS } from "../lib/keyring";
import { PROVIDERS, providerNeedsKey } from "../config";

describe("keyring.ts — OpenCode provider key", () => {
  it("EMPTY_PROVIDER_KEYS has opencode as null", () => {
    expect(EMPTY_PROVIDER_KEYS).toHaveProperty("opencode", null);
  });

  it("EMPTY_PROVIDER_KEYS has an entry for every non-keyless provider", () => {
    const keyless = new Set(["lmstudio"]);
    for (const p of PROVIDERS) {
      if (keyless.has(p.id)) continue;
      expect(EMPTY_PROVIDER_KEYS).toHaveProperty(p.id);
    }
  });

  it("opencode is not a keyless provider", () => {
    expect(providerNeedsKey("opencode")).toBe(true);
  });
});
