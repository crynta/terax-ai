import { describe, expect, it } from "vitest";
// Relative path on purpose: the bare `zod/v3` specifier is aliased to the shim.
import { ZodFirstPartyTypeKind as real } from "../../../../node_modules/zod/v3/types.js";
import { ZodFirstPartyTypeKind } from "./zodV3Shim";

describe("zod 3 shim", () => {
  it("mirrors the real ZodFirstPartyTypeKind member for member", () => {
    expect(ZodFirstPartyTypeKind).toEqual({ ...real });
  });
});
