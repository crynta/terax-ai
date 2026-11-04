import { describe, expect, it, vi } from "vitest";
import type { GhosttyLinkCells } from "./GhosttyTerminalModel";
import {
  damagedRows,
  damageWithRows,
  TerminalLinkUnderlines,
} from "./TerminalLinkUnderlines";

/** A screen of `rows` rows whose links are given per row; rows 1-2 form one wrapped line. */
function linkModel(screen: Map<number, { start: number; end: number }[]>) {
  const linkCellsInRows = vi.fn(
    (first: number, last: number): GhosttyLinkCells => {
      const start = first === 2 ? 1 : first;
      const end = last === 1 ? 2 : last;
      const spans = [];
      for (let row = start; row <= end; row++) {
        for (const span of screen.get(row) ?? []) spans.push({ row, ...span });
      }
      return { start, end, spans };
    },
  );
  return { linkCellsInRows };
}

describe("TerminalLinkUnderlines", () => {
  it("marks link cells and reports only rows whose links changed", () => {
    const screen = new Map([[0, [{ start: 2, end: 5 }]]]);
    const model = linkModel(screen);
    const links = new TerminalLinkUnderlines();

    expect(links.update(model, 4, 10, [{ start: 0, end: 3 }])).toEqual([
      { start: 0, end: 0 },
    ]);
    expect(links.isLink(0, 1)).toBe(false);
    expect(links.isLink(0, 2)).toBe(true);
    expect(links.isLink(0, 5)).toBe(true);
    expect(links.isLink(0, 6)).toBe(false);
    expect(links.rowHasLinks(0)).toBe(true);
    expect(links.rowHasLinks(3)).toBe(false);

    // Same content again: nothing changed.
    expect(links.update(model, 4, 10, [{ start: 0, end: 0 }])).toEqual([]);

    screen.delete(0);
    expect(links.update(model, 4, 10, [{ start: 0, end: 0 }])).toEqual([
      { start: 0, end: 0 },
    ]);
    expect(links.rowHasLinks(0)).toBe(false);
  });

  it("rescans a whole wrapped line and reports its undamaged rows", () => {
    const screen = new Map([
      [1, [{ start: 6, end: 9 }]],
      [2, [{ start: 0, end: 3 }]],
    ]);
    const model = linkModel(screen);
    const links = new TerminalLinkUnderlines();
    links.update(model, 4, 10, [{ start: 0, end: 3 }]);

    // Only row 2 was rewritten, and the link it continued is gone from both rows.
    screen.clear();
    expect(links.update(model, 4, 10, [{ start: 2, end: 2 }])).toEqual([
      { start: 1, end: 2 },
    ]);
    expect(model.linkCellsInRows).toHaveBeenLastCalledWith(2, 2);
    expect(links.isLink(1, 6)).toBe(false);
  });

  it("starts over when the grid size changes and ignores models without link cells", () => {
    const model = linkModel(new Map([[0, [{ start: 0, end: 0 }]]]));
    const links = new TerminalLinkUnderlines();
    links.update(model, 2, 4, [{ start: 0, end: 1 }]);
    expect(links.update(model, 3, 6, [{ start: 0, end: 2 }])).toEqual([
      { start: 0, end: 0 },
    ]);
    expect(links.isLink(0, 0)).toBe(true);
    expect(links.update({}, 3, 6, [{ start: 0, end: 2 }])).toEqual([]);
  });
});

describe("damage helpers", () => {
  it("lists damaged rows and widens damage by link rows", () => {
    expect(damagedRows({ kind: "none" }, 5)).toEqual([]);
    expect(damagedRows({ kind: "full" }, 5)).toEqual([{ start: 0, end: 4 }]);
    expect(
      damageWithRows({ kind: "rows", ranges: [{ start: 3, end: 3 }] }, [
        { start: 1, end: 2 },
        { start: 6, end: 6 },
      ]),
    ).toEqual({
      kind: "rows",
      ranges: [
        { start: 1, end: 3 },
        { start: 6, end: 6 },
      ],
    });
    expect(damageWithRows({ kind: "none" }, [{ start: 0, end: 0 }])).toEqual({
      kind: "rows",
      ranges: [{ start: 0, end: 0 }],
    });
    expect(damageWithRows({ kind: "full" }, [{ start: 0, end: 0 }])).toEqual({
      kind: "full",
    });
  });
});
