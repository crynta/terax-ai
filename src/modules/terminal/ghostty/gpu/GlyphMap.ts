import { ATLAS_FULL } from "./GlyphAtlas";

/** Never rasterized in this atlas epoch; queued for rasterization. */
export const GLYPH_PENDING = 0xffff_ffff;
/** Rasterized before the last atlas flush; re-queued only if it is shown. */
export const GLYPH_EVICTED = 0xffff_fffe;

const MIN_ENTRIES = 1_024;
const MAX_ENTRIES = 65_536;
const GLYPH_ID_MASK = 0x00ff_ffff;
/** More queued glyphs than this and only the visible ones stay queued. */
export const BACKLOG_THRESHOLD = 256;
const QUEUED_NORMAL = 1;
const QUEUED_URGENT = 2;

export type GlyphSource = {
  readonly id: number;
  readonly style: number;
  readonly text: string;
};

export type GlyphResolver = {
  readonly epoch: number;
  resolve(text: string, style: number): number;
};

export type RasterBudget = {
  /** True once `allowanceMs` (default: the frame's own limit) has elapsed. */
  exhausted(allowanceMs?: number): boolean;
};

export type GlyphProcessResult = {
  /** Glyphs mapped by this call. */
  readonly resolved: number;
  /** The atlas has no room left; the owner must flush it between frames. */
  readonly full: boolean;
};

/**
 * One terminal's `glyph_map`: Ghostty glyph id -> atlas table index. The
 * buffer content lives in `entries`; this class tracks what changed, which ids
 * still need rasterizing, and which were lost to an atlas flush. Nothing here
 * looks at cells in steady state: ids arrive from the model's new-glyph list,
 * and cells are only scanned while some ids are marked evicted.
 */
export class TerminalGlyphMap {
  private values = new Uint32Array(MIN_ENTRIES).fill(GLYPH_PENDING);
  private texts: Array<string | undefined> = [];
  private styles = new Uint8Array(MIN_ENTRIES);
  private queued = new Uint8Array(MIN_ENTRIES);
  private visibleMark = new Uint8Array(0);
  private normal: number[] = [];
  private normalHead = 0;
  private urgent: number[] = [];
  private urgentHead = 0;
  private evictedCount = 0;
  private zigEpochValue = -1;
  private atlasEpochValue = -1;
  private dirtyStart = Number.POSITIVE_INFINITY;
  private dirtyEnd = -1;

  get entries(): Uint32Array {
    return this.values;
  }

  get capacity(): number {
    return this.values.length;
  }

  get zigEpoch(): number {
    return this.zigEpochValue;
  }

  get atlasEpoch(): number {
    return this.atlasEpochValue;
  }

  get pending(): number {
    return (
      this.normal.length -
      this.normalHead +
      this.urgent.length -
      this.urgentHead
    );
  }

  /** Some ids were evicted: cells must be scanned for them as they change. */
  get recovering(): boolean {
    return this.evictedCount > 0;
  }

  get byteSize(): number {
    return (
      this.values.byteLength + this.styles.byteLength + this.queued.byteLength
    );
  }

  /** Drops every mapping for a new Ghostty glyph epoch. */
  resetForEpoch(zigEpoch: number): void {
    this.zigEpochValue = zigEpoch;
    this.values.fill(GLYPH_PENDING);
    this.queued.fill(0);
    this.texts = [];
    this.normal = [];
    this.normalHead = 0;
    this.urgent = [];
    this.urgentHead = 0;
    this.evictedCount = 0;
    this.markDirty(0, this.values.length - 1);
  }

  /** Grows storage for ids up to `glyphCount`; true if `entries` was replaced. */
  ensureCapacity(glyphCount: number): boolean {
    const needed = glyphCount + 1;
    if (needed > MAX_ENTRIES) {
      throw new RangeError(`Ghostty reported ${glyphCount} glyphs`);
    }
    if (needed <= this.values.length) return false;
    let next = this.values.length;
    while (next < needed) next *= 2;
    const values = new Uint32Array(next).fill(GLYPH_PENDING);
    values.set(this.values);
    this.values = values;
    const styles = new Uint8Array(next);
    styles.set(this.styles);
    this.styles = styles;
    const queued = new Uint8Array(next);
    queued.set(this.queued);
    this.queued = queued;
    this.markDirty(0, next - 1);
    return true;
  }

  add(glyphs: readonly GlyphSource[]): void {
    for (const glyph of glyphs) {
      const id = glyph.id;
      if (id <= 0 || id >= this.values.length) {
        throw new RangeError(`Ghostty glyph id ${id} exceeds the glyph map`);
      }
      this.texts[id] = glyph.text;
      this.styles[id] = glyph.style;
      if (
        this.values[id] === GLYPH_PENDING &&
        (this.queued[id] & QUEUED_NORMAL) === 0
      ) {
        this.queued[id] |= QUEUED_NORMAL;
        this.normal.push(id);
      }
    }
  }

  /** An atlas flush or resume voided every resolved index. */
  invalidateAtlas(atlasEpoch: number): void {
    this.atlasEpochValue = atlasEpoch;
    let changed = false;
    for (let id = 1; id < this.values.length; id += 1) {
      const value = this.values[id];
      if (value >= GLYPH_EVICTED) continue;
      this.values[id] = GLYPH_EVICTED;
      this.evictedCount += 1;
      changed = true;
    }
    if (changed) this.markDirty(0, this.values.length - 1);
  }

  /** Adopts the atlas epoch for a map that holds no resolved ids yet. */
  adoptAtlasEpoch(atlasEpoch: number): void {
    this.atlasEpochValue = atlasEpoch;
  }

  /**
   * Queues evicted ids that appear in `ranges` of `cells` (row ranges,
   * inclusive). Visible glyphs are rasterized before any others.
   */
  scanCells(
    cells: Uint8Array,
    cols: number,
    ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>,
  ): number {
    if (this.evictedCount === 0) return 0;
    const words = new Uint32Array(
      cells.buffer,
      cells.byteOffset,
      Math.floor(cells.byteLength / 4),
    );
    let found = 0;
    for (const range of ranges) {
      const first = range.start * cols * 4;
      const last = Math.min(words.length, (range.end + 1) * cols * 4);
      for (let word = first; word < last; word += 4) {
        const id = words[word] & GLYPH_ID_MASK;
        if (id === 0 || id >= this.values.length) continue;
        if (this.values[id] !== GLYPH_EVICTED) continue;
        this.values[id] = GLYPH_PENDING;
        this.evictedCount -= 1;
        this.markDirty(id, id);
        if ((this.queued[id] & QUEUED_URGENT) === 0) {
          this.queued[id] |= QUEUED_URGENT;
          this.urgent.push(id);
        }
        found += 1;
      }
    }
    return found;
  }

  /**
   * A large backlog means glyphs scrolled away before they were drawn (a
   * flood of output). Rebuilds the queue from what the viewport shows now and
   * demotes every other queued glyph to evicted: it is rasterized only if it
   * reappears in a changed row. Returns how many glyphs were demoted.
   */
  shedBacklog(cells: Uint8Array, cols: number, rows: number): number {
    if (this.pending <= BACKLOG_THRESHOLD) return 0;
    const words = new Uint32Array(
      cells.buffer,
      cells.byteOffset,
      Math.floor(cells.byteLength / 4),
    );
    const last = Math.min(words.length, cols * rows * 4);
    if (this.visibleMark.length !== this.values.length) {
      this.visibleMark = new Uint8Array(this.values.length);
    } else {
      this.visibleMark.fill(0);
    }
    const visible: number[] = [];
    for (let word = 0; word < last; word += 4) {
      const id = words[word] & GLYPH_ID_MASK;
      if (id === 0 || id >= this.values.length) continue;
      if (this.values[id] !== GLYPH_PENDING || this.visibleMark[id] !== 0) {
        continue;
      }
      this.visibleMark[id] = 1;
      visible.push(id);
    }
    let demoted = 0;
    const drop = (queue: number[], head: number) => {
      for (let index = head; index < queue.length; index += 1) {
        const id = queue[index];
        this.queued[id] = 0;
        if (this.values[id] !== GLYPH_PENDING || this.visibleMark[id] !== 0) {
          continue;
        }
        this.values[id] = GLYPH_EVICTED;
        this.evictedCount += 1;
        demoted += 1;
      }
    };
    drop(this.urgent, this.urgentHead);
    drop(this.normal, this.normalHead);
    for (const id of visible) this.queued[id] = QUEUED_URGENT;
    this.urgent = visible;
    this.urgentHead = 0;
    this.normal = [];
    this.normalHead = 0;
    if (demoted > 0) this.markDirty(0, this.values.length - 1);
    return demoted;
  }

  /**
   * Rasterizes queued glyphs into `atlas` until the queue is empty, the budget
   * is spent (at least one glyph is always mapped), or the atlas is full.
   */
  process(
    atlas: GlyphResolver,
    budget: RasterBudget,
    allowanceMs?: number,
  ): GlyphProcessResult {
    let resolved = 0;
    for (;;) {
      const fromUrgent = this.urgentHead < this.urgent.length;
      if (!fromUrgent && this.normalHead >= this.normal.length) break;
      if (resolved > 0 && budget.exhausted(allowanceMs)) break;
      const id = fromUrgent
        ? this.urgent[this.urgentHead]
        : this.normal[this.normalHead];
      const text = this.texts[id];
      if (this.values[id] !== GLYPH_PENDING || text === undefined) {
        this.shift(fromUrgent, id);
        continue;
      }
      const index = atlas.resolve(text, this.styles[id]);
      if (index === ATLAS_FULL) return { resolved, full: true };
      this.values[id] = index;
      this.markDirty(id, id);
      this.shift(fromUrgent, id);
      resolved += 1;
    }
    this.compact();
    return { resolved, full: false };
  }

  /** Inclusive id range changed since the last call, or null. */
  takeDirty(): { readonly start: number; readonly end: number } | null {
    if (this.dirtyEnd < 0) return null;
    const range = { start: this.dirtyStart, end: this.dirtyEnd };
    this.dirtyStart = Number.POSITIVE_INFINITY;
    this.dirtyEnd = -1;
    return range;
  }

  markAllDirty(): void {
    this.markDirty(0, this.values.length - 1);
  }

  private shift(fromUrgent: boolean, id: number): void {
    this.queued[id] &= fromUrgent ? ~QUEUED_URGENT : ~QUEUED_NORMAL;
    if (fromUrgent) this.urgentHead += 1;
    else this.normalHead += 1;
  }

  private compact(): void {
    if (this.urgentHead >= this.urgent.length) {
      this.urgent = [];
      this.urgentHead = 0;
    }
    if (this.normalHead >= this.normal.length) {
      this.normal = [];
      this.normalHead = 0;
    } else if (this.normalHead > 4_096) {
      this.normal = this.normal.slice(this.normalHead);
      this.normalHead = 0;
    }
  }

  private markDirty(start: number, end: number): void {
    this.dirtyStart = Math.min(this.dirtyStart, start);
    this.dirtyEnd = Math.max(this.dirtyEnd, end);
  }
}
