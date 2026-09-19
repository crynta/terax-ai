import { describe, expect, it } from "vitest";
import { formatSearchCount, searchMissed } from "./searchCount";

describe("formatSearchCount", () => {
  it("hides the counter until a query has results", () => {
    expect(
      formatSearchCount("", { current: 0, total: 0, complete: true }),
    ).toBe(null);
    expect(formatSearchCount("x", null)).toBe(null);
    expect(
      formatSearchCount("x", { current: 0, total: 0, complete: false }),
    ).toBe(null);
  });

  it("shows 0 when search finished with no hits", () => {
    expect(
      formatSearchCount("x", { current: 0, total: 0, complete: true }),
    ).toBe("0");
  });

  it("shows current over total and treats an unselected hit as the first", () => {
    expect(
      formatSearchCount("x", { current: 3, total: 40, complete: true }),
    ).toBe("3/40");
    expect(
      formatSearchCount("x", { current: 4, total: 40, complete: true }),
    ).toBe("4/40");
    expect(
      formatSearchCount("x", { current: 0, total: 12, complete: false }),
    ).toBe("1/12");
  });
});

describe("searchMissed", () => {
  it("is red only after a completed empty search", () => {
    expect(searchMissed("", { current: 0, total: 0, complete: true })).toBe(
      false,
    );
    expect(searchMissed("x", { current: 0, total: 0, complete: false })).toBe(
      false,
    );
    expect(searchMissed("x", { current: 0, total: 0, complete: true })).toBe(
      true,
    );
    expect(searchMissed("x", { current: 1, total: 3, complete: true })).toBe(
      false,
    );
  });
});
