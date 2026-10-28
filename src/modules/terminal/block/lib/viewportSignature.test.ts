import { describe, expect, it } from "vitest";
import {
  type BlockViewportSignature,
  sameBlockViewport,
} from "./viewportSignature";

const base: BlockViewportSignature = {
  mode: "prompt",
  revision: 3,
  origin: 120,
  history: 400,
  rows: 40,
  cols: 100,
  cellHeight: 19,
  cursorLine: -1,
};

describe("sameBlockViewport", () => {
  it("is equal for identical signatures", () => {
    expect(sameBlockViewport(base, { ...base })).toBe(true);
  });

  it.each([
    ["mode", { mode: "running" as const }],
    ["block set", { revision: 4 }],
    ["scroll origin", { origin: 121 }],
    ["scrollback length", { history: 401 }],
    ["rows", { rows: 41 }],
    ["cols (reflow)", { cols: 101 }],
    ["cell height (zoom or font change)", { cellHeight: 20 }],
    ["running cursor line", { cursorLine: 150 }],
  ])("differs when the %s changes", (_name, patch) => {
    expect(sameBlockViewport(base, { ...base, ...patch })).toBe(false);
  });
});
