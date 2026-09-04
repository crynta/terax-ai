import { describe, expect, it } from "vitest";
import { parseOpenRequest } from "./useControlBridge";

describe("parseOpenRequest", () => {
  it("defaults focus only when it is absent", () => {
    expect(parseOpenRequest({ path: "/repo/main.rs" }).focus).toBe(true);
    expect(
      parseOpenRequest({ path: "/repo/main.rs", focus: false }).focus,
    ).toBe(false);
  });

  it.each([0, "false", null, {}])(
    "rejects non-boolean focus value %o",
    (focus) => {
      expect(() => parseOpenRequest({ path: "/repo/main.rs", focus })).toThrow(
        "focus must be a boolean",
      );
    },
  );
});
