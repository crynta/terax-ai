import { describe, expect, it } from "vitest";
import { ATLAS_FULL } from "./GlyphAtlas";
import {
  BACKLOG_THRESHOLD,
  GLYPH_EVICTED,
  GLYPH_PENDING,
  TerminalGlyphMap,
  type GlyphResolver,
} from "./GlyphMap";

class FakeAtlas implements GlyphResolver {
  epoch = 1;
  capacity = Number.POSITIVE_INFINITY;
  readonly resolved: string[] = [];
  private readonly indices = new Map<string, number>();

  resolve(text: string, style: number): number {
    const key = `${style}:${text}`;
    const existing = this.indices.get(key);
    if (existing !== undefined) return existing;
    if (this.indices.size >= this.capacity) return ATLAS_FULL;
    const index = this.indices.size;
    this.indices.set(key, index);
    this.resolved.push(key);
    return index;
  }

  flush(): void {
    this.indices.clear();
    this.epoch += 1;
  }
}

const unlimited = { exhausted: () => false };
const oneAtATime = { exhausted: () => true };

function glyphs(...texts: string[]) {
  return texts.map((text, index) => ({ id: index + 1, style: 0, text }));
}

/** Packs row-major cell records whose word 0 holds the given glyph ids. */
function cells(ids: number[]): Uint8Array {
  const words = new Uint32Array(ids.length * 4);
  ids.forEach((id, index) => {
    words[index * 4] = id | (3 << 24);
  });
  return new Uint8Array(words.buffer);
}

describe("TerminalGlyphMap", () => {
  it("queues announced glyphs and maps them through the atlas", () => {
    const map = new TerminalGlyphMap();
    const atlas = new FakeAtlas();
    map.ensureCapacity(3);
    map.resetForEpoch(1);
    map.adoptAtlasEpoch(atlas.epoch);
    map.add(glyphs("a", "b", "c"));
    expect(map.pending).toBe(3);
    expect(map.entries[1]).toBe(GLYPH_PENDING);
    expect(map.takeDirty()).toEqual({ start: 0, end: 1_023 });
    const result = map.process(atlas, unlimited);
    expect(result).toEqual({ resolved: 3, full: false });
    expect([...map.entries.slice(1, 4)]).toEqual([0, 1, 2]);
    expect(map.pending).toBe(0);
    expect(map.takeDirty()).toEqual({ start: 1, end: 3 });
    expect(map.takeDirty()).toBeNull();
  });

  it("stops at the budget after at least one glyph and resumes where it left off", () => {
    const map = new TerminalGlyphMap();
    const atlas = new FakeAtlas();
    map.ensureCapacity(5);
    map.resetForEpoch(1);
    map.add(glyphs("a", "b", "c", "d", "e"));
    expect(map.process(atlas, oneAtATime).resolved).toBe(1);
    expect(map.pending).toBe(4);
    let rounds = 1;
    while (map.pending > 0) {
      map.process(atlas, oneAtATime);
      rounds += 1;
    }
    expect(rounds).toBe(5);
    expect(atlas.resolved).toEqual(["0:a", "0:b", "0:c", "0:d", "0:e"]);
  });

  it("uses the larger allowance the caller passes for first frames", () => {
    const map = new TerminalGlyphMap();
    const seen: Array<number | undefined> = [];
    map.ensureCapacity(3);
    map.resetForEpoch(1);
    map.add(glyphs("a", "b", "c"));
    map.process(
      new FakeAtlas(),
      {
        exhausted: (ms) => {
          seen.push(ms);
          return false;
        },
      },
      8,
    );
    expect(seen).toEqual([8, 8]);
  });

  it("deduplicates repeated announcements and keeps resolved indices on resync", () => {
    const map = new TerminalGlyphMap();
    const atlas = new FakeAtlas();
    map.ensureCapacity(2);
    map.resetForEpoch(1);
    map.add(glyphs("a", "b"));
    map.process(atlas, unlimited);
    map.add(glyphs("a", "b"));
    expect(map.pending).toBe(0);
    expect(map.entries[1]).toBe(0);
    map.add(glyphs("a", "b"));
    map.process(atlas, unlimited);
    expect(atlas.resolved).toHaveLength(2);
  });

  it("drops everything for a new Ghostty epoch", () => {
    const map = new TerminalGlyphMap();
    const atlas = new FakeAtlas();
    map.ensureCapacity(2);
    map.resetForEpoch(1);
    map.add(glyphs("a", "b"));
    map.process(atlas, unlimited);
    map.resetForEpoch(2);
    expect(map.zigEpoch).toBe(2);
    expect(map.entries[1]).toBe(GLYPH_PENDING);
    expect(map.pending).toBe(0);
    map.add([{ id: 1, style: 0, text: "z" }]);
    map.process(atlas, unlimited);
    expect(map.entries[1]).toBe(atlas.resolved.indexOf("0:z"));
  });

  it("grows its storage with the glyph count and reports the replacement", () => {
    const map = new TerminalGlyphMap();
    map.resetForEpoch(1);
    expect(map.capacity).toBe(1_024);
    expect(map.ensureCapacity(1_023)).toBe(false);
    expect(map.ensureCapacity(1_024)).toBe(true);
    expect(map.capacity).toBe(2_048);
    expect(map.entries[2_047]).toBe(GLYPH_PENDING);
    expect(() => map.ensureCapacity(70_000)).toThrow(RangeError);
    expect(() => map.add([{ id: 9_999, style: 0, text: "x" }])).toThrow(
      RangeError,
    );
  });

  it("evicts on an atlas flush and re-queues only glyphs that are shown", () => {
    const map = new TerminalGlyphMap();
    const atlas = new FakeAtlas();
    map.ensureCapacity(4);
    map.resetForEpoch(1);
    map.adoptAtlasEpoch(atlas.epoch);
    map.add(glyphs("a", "b", "c", "d"));
    map.process(atlas, unlimited);
    map.takeDirty();

    atlas.flush();
    map.invalidateAtlas(atlas.epoch);
    expect(map.recovering).toBe(true);
    expect([...map.entries.slice(1, 5)]).toEqual([
      GLYPH_EVICTED,
      GLYPH_EVICTED,
      GLYPH_EVICTED,
      GLYPH_EVICTED,
    ]);
    expect(map.pending).toBe(0);

    // Two cells show glyphs 2 and 4; only those come back.
    const found = map.scanCells(cells([2, 0, 4, 2]), 4, [{ start: 0, end: 0 }]);
    expect(found).toBe(2);
    expect(map.pending).toBe(2);
    map.process(atlas, unlimited);
    expect(atlas.resolved.slice(-2)).toEqual(["0:b", "0:d"]);
    expect(map.entries[1]).toBe(GLYPH_EVICTED);
    expect(map.entries[3]).toBe(GLYPH_EVICTED);
    expect(map.recovering).toBe(true);

    // Later output shows glyph 1: it is found in the dirty rows and restored.
    map.scanCells(cells([1, 0, 0, 0, 0, 0, 0, 0]), 4, [{ start: 1, end: 1 }]);
    expect(
      map.scanCells(cells([0, 0, 0, 0, 1, 0, 0, 0]), 4, [{ start: 1, end: 1 }]),
    ).toBe(1);
    map.process(atlas, unlimited);
    expect(map.entries[1]).toBeLessThan(GLYPH_EVICTED);
  });

  it("scans only the requested rows and nothing at all when no glyph is evicted", () => {
    const map = new TerminalGlyphMap();
    map.ensureCapacity(2);
    map.resetForEpoch(1);
    map.add(glyphs("a", "b"));
    expect(map.scanCells(cells([1, 2]), 1, [{ start: 0, end: 1 }])).toBe(0);
    map.process(new FakeAtlas(), unlimited);
    map.invalidateAtlas(5);
    expect(map.scanCells(cells([1, 2]), 1, [{ start: 1, end: 1 }])).toBe(1);
    expect(map.entries[1]).toBe(GLYPH_EVICTED);
    expect(map.pending).toBe(1);
  });

  it("reports a full atlas without losing the queue", () => {
    const map = new TerminalGlyphMap();
    const atlas = new FakeAtlas();
    atlas.capacity = 2;
    map.ensureCapacity(4);
    map.resetForEpoch(1);
    map.add(glyphs("a", "b", "c", "d"));
    const result = map.process(atlas, unlimited);
    expect(result).toEqual({ resolved: 2, full: true });
    expect(map.pending).toBe(2);
    atlas.flush();
    map.invalidateAtlas(atlas.epoch);
    atlas.capacity = 10;
    // The unresolved glyphs were never mapped, so they finish normally.
    expect(map.process(atlas, unlimited)).toEqual({ resolved: 2, full: false });
    expect(map.pending).toBe(0);
  });

  it("sheds a backlog down to the glyphs on screen and restores the rest on demand", () => {
    const map = new TerminalGlyphMap();
    const atlas = new FakeAtlas();
    const count = BACKLOG_THRESHOLD + 200;
    map.ensureCapacity(count);
    map.resetForEpoch(1);
    map.add(
      Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        style: 0,
        text: String.fromCharCode(0x300 + index),
      })),
    );
    // A small backlog is left alone.
    const small = new TerminalGlyphMap();
    small.ensureCapacity(10);
    small.resetForEpoch(1);
    small.add(glyphs("a", "b"));
    expect(small.shedBacklog(cells([1, 2]), 2, 1)).toBe(0);
    expect(small.pending).toBe(2);

    // Glyphs 5, 9 and the last one are on screen; everything else scrolled away.
    const visible = cells([5, 9, count, 5]);
    const demoted = map.shedBacklog(visible, 4, 1);
    expect(demoted).toBe(count - 3);
    expect(map.pending).toBe(3);
    expect(map.recovering).toBe(true);
    map.process(atlas, unlimited);
    expect(atlas.resolved).toHaveLength(3);
    expect(map.entries[5]).toBeLessThan(GLYPH_EVICTED);
    expect(map.entries[6]).toBe(GLYPH_EVICTED);

    // A glyph that was shed comes back through a changed row.
    expect(map.scanCells(cells([6, 0, 0, 0]), 4, [{ start: 0, end: 0 }])).toBe(
      1,
    );
    map.process(atlas, unlimited);
    expect(map.entries[6]).toBeLessThan(GLYPH_EVICTED);
  });

  it("does not rasterize a glyph twice when it sits in both queues", () => {
    const map = new TerminalGlyphMap();
    const atlas = new FakeAtlas();
    const count = BACKLOG_THRESHOLD + 10;
    map.ensureCapacity(count);
    map.resetForEpoch(1);
    map.add(
      Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        style: 0,
        text: String.fromCharCode(0x300 + index),
      })),
    );
    map.shedBacklog(cells([1, 2, 3, 4]), 4, 1);
    map.process(atlas, unlimited);
    expect(atlas.resolved).toHaveLength(4);
    expect(map.pending).toBe(0);
  });

  it("drops stale urgent entries when newer output replaces the screen", () => {
    const map = new TerminalGlyphMap();
    const atlas = new FakeAtlas();
    const count = BACKLOG_THRESHOLD * 3;
    map.ensureCapacity(count);
    map.resetForEpoch(1);
    map.add(
      Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        style: 0,
        text: String.fromCharCode(0x300 + index),
      })),
    );
    // First screen: glyphs 1..300 were visible and queued, none drawn yet.
    const first = cells(Array.from({ length: 300 }, (_, index) => index + 1));
    map.shedBacklog(first, 300, 1);
    expect(map.pending).toBe(300);
    // The screen is replaced by glyphs 601..640 before anything was drawn;
    // those were shed earlier, so the changed row brings them back first.
    const second = cells(Array.from({ length: 40 }, (_, index) => 601 + index));
    map.scanCells(second, 40, [{ start: 0, end: 0 }]);
    map.shedBacklog(second, 40, 1);
    expect(map.pending).toBe(40);
    map.process(atlas, unlimited);
    expect(atlas.resolved).toHaveLength(40);
    expect(map.entries[1]).toBe(GLYPH_EVICTED);
    expect(map.entries[601]).toBeLessThan(GLYPH_EVICTED);
  });
});
