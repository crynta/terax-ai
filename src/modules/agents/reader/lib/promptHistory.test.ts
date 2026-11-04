import { describe, expect, it } from "vitest";
import {
  buildHistory,
  historyDown,
  historyEscape,
  historyUp,
  shouldBrowseUp,
  startNav,
} from "./promptHistory";

describe("prompt history", () => {
  it("builds oldest-first entries without blanks or repeats", () => {
    expect(buildHistory(["a", null, "  ", "b", "b"], ["b", "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("walks up and down and returns to the draft", () => {
    let nav = startNav(["one", "two"], "draft");
    const up1 = historyUp(nav);
    expect(up1?.text).toBe("two");
    nav = up1?.nav ?? nav;
    const up2 = historyUp(nav);
    expect(up2?.text).toBe("one");
    nav = up2?.nav ?? nav;
    expect(historyUp(nav)).toBeNull();
    const down1 = historyDown(nav);
    expect(down1?.text).toBe("two");
    nav = down1?.nav ?? nav;
    const down2 = historyDown(nav);
    expect(down2?.text).toBe("draft");
    expect(down2?.nav.index).toBeNull();
    expect(historyDown(down2?.nav ?? nav)).toBeNull();
  });

  it("escape restores the draft", () => {
    const nav = historyUp(startNav(["x"], "mine"))?.nav;
    expect(nav && historyEscape(nav)).toEqual({
      nav: { entries: ["x"], index: null, draft: "mine" },
      text: "mine",
    });
    expect(historyUp(startNav([], ""))).toBeNull();
  });

  it("browses on ↑ only when empty, browsing, or at the start of one line", () => {
    expect(shouldBrowseUp("", 0, false)).toBe(true);
    expect(shouldBrowseUp("text", 0, false)).toBe(true);
    expect(shouldBrowseUp("text", 2, false)).toBe(false);
    expect(shouldBrowseUp("a\nb", 0, false)).toBe(false);
    expect(shouldBrowseUp("a\nb", 3, true)).toBe(true);
  });
});
