import { describe, expect, it } from "vitest";
import { appendBlock, placeAskPill, selectionToQuote } from "./askSelection";
import {
  dropMentionRef,
  needsMultiline,
  pointInRect,
  routeDroppedPaths,
  toLogicalPoint,
} from "./composerDrop";

describe("selectionToQuote", () => {
  it("quotes prose line by line and leaves room for the question", () => {
    expect(
      selectionToQuote({
        text: "  Level 2 expiry never runs ahead.\nSo a tiering outage costs freshness.  ",
        code: false,
        lang: null,
      }),
    ).toBe(
      "> Level 2 expiry never runs ahead.\n> So a tiering outage costs freshness.\n\n",
    );
  });

  it("collapses blank-line runs and normalises line endings", () => {
    expect(
      selectionToQuote({ text: "a\r\n\r\n\r\nb", code: false, lang: null }),
    ).toBe("> a\n>\n> b\n\n");
  });

  it("fences code with its language and a fence longer than any backticks", () => {
    expect(
      selectionToQuote({ text: "\nconst a = 1;\n", code: true, lang: "TS" }),
    ).toBe("```ts\nconst a = 1;\n```\n\n");
    expect(
      selectionToQuote({ text: "echo ```x```", code: true, lang: "bash" }),
    ).toBe("````bash\necho ```x```\n````\n\n");
    expect(
      selectionToQuote({ text: "plain output", code: true, lang: "text" }),
    ).toBe("```\nplain output\n```\n\n");
  });

  it("ignores selections that are too short", () => {
    expect(selectionToQuote({ text: " a ", code: false, lang: null })).toBe("");
    expect(selectionToQuote({ text: "\n", code: true, lang: "ts" })).toBe("");
  });
});

describe("appendBlock", () => {
  it("starts an empty draft and appends after a blank line otherwise", () => {
    expect(appendBlock("", "> q\n\n")).toBe("> q\n\n");
    expect(appendBlock("first question  \n", "> q\n\n")).toBe(
      "first question\n\n> q\n\n",
    );
    expect(appendBlock("> one\n\n", "> two\n\n")).toBe("> one\n\n> two\n\n");
    expect(appendBlock("keep", "")).toBe("keep");
  });
});

describe("placeAskPill", () => {
  const bounds = { left: 100, top: 50, right: 900, bottom: 650 };
  const pill = { width: 110, height: 28 };
  it("centres above the end of the selection", () => {
    expect(
      placeAskPill(
        { left: 300, top: 300, right: 500, bottom: 320 },
        bounds,
        pill,
      ),
    ).toEqual({ left: 500 - 55 - 100, top: 300 - 28 - 8 - 50 });
  });
  it("goes below when there's no room above and stays inside the edges", () => {
    const below = placeAskPill(
      { left: 860, top: 60, right: 895, bottom: 80 },
      bounds,
      pill,
    );
    expect(below.top).toBe(80 + 8 - 50);
    expect(below.left).toBe(900 - 110 - 6 - 100);
    const left = placeAskPill(
      { left: 101, top: 300, right: 104, bottom: 320 },
      bounds,
      pill,
    );
    expect(left.left).toBe(6);
  });
});

describe("routeDroppedPaths", () => {
  it("attaches images, mentions other files and reports HEIC", () => {
    expect(
      routeDroppedPaths([
        "/Users/me/Desktop/Shot.PNG",
        "/tmp/photo.jpeg",
        "/tmp/a.webp",
        "/tmp/IMG_1.HEIC",
        "/repo/src/main.rs",
        "/repo/README",
      ]),
    ).toEqual({
      images: ["/Users/me/Desktop/Shot.PNG", "/tmp/photo.jpeg", "/tmp/a.webp"],
      files: ["/repo/src/main.rs", "/repo/README"],
      unsupported: ["/tmp/IMG_1.HEIC"],
    });
  });
});

describe("dropMentionRef", () => {
  it("is relative inside the session folder and absolute elsewhere", () => {
    expect(dropMentionRef("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(dropMentionRef("/repo/src/a.ts", "/repo/")).toBe("src/a.ts");
    expect(dropMentionRef("/repository/x.ts", "/repo")).toBe(
      "/repository/x.ts",
    );
    expect(dropMentionRef("/tmp/x.ts", null)).toBe("/tmp/x.ts");
  });
});

describe("drop geometry", () => {
  const viewport = { width: 1000, height: 800, dpr: 2 };
  it("scales physical positions only when they overflow the viewport", () => {
    expect(toLogicalPoint(400, 300, viewport)).toEqual({ x: 400, y: 300 });
    expect(toLogicalPoint(1600, 1200, viewport)).toEqual({ x: 800, y: 600 });
  });
  it("hit-tests the composer rectangle inclusively", () => {
    const rect = { left: 10, top: 20, right: 110, bottom: 70 };
    expect(pointInRect({ x: 10, y: 70 }, rect)).toBe(true);
    expect(pointInRect({ x: 60, y: 45 }, rect)).toBe(true);
    expect(pointInRect({ x: 111, y: 45 }, rect)).toBe(false);
  });
});

describe("needsMultiline", () => {
  it("switches on newlines or when the text won't fit beside the controls", () => {
    expect(needsMultiline("a\nb", 10, 500)).toBe(true);
    expect(needsMultiline("short", 120, 500)).toBe(false);
    expect(needsMultiline("long", 520, 500)).toBe(true);
    expect(needsMultiline("unmeasured", 520, 0)).toBe(false);
  });
});
