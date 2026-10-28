import { SMOOTH_KEY, type SmoothHooks } from "./smoothHooks";

/**
 * Smoothness probe for the app lab (`split-drag` and `resize` scenarios).
 *
 * Product code reports a handful of timestamps through `smoothHooks()` (always inside
 * `if (__TERAX_BENCH__)`, so none of it exists in a normal build); this module turns them into
 * the numbers that describe how a resize gesture looks: how often frames reach the screen, how
 * long a pane's text lags behind the layout it is drawn in, how long a pane stayed frozen on its
 * previous frame, and how many frames showed a prompt that a resize had just erased.
 */

type PaneState = {
  wantCols: number;
  wantRows: number;
  haveCols: number;
  haveRows: number;
  /** When the grid first differed from the wanted one since the last application. */
  firstWantAt: number | null;
  staleSince: number | null;
  staleMs: number;
  applied: number;
  rectAt: number | null;
  /** First time each grid size was asked for (recent ones). */
  asked: Map<string, number>;
  askedCols: number;
  askedRows: number;
  shownCols: number;
  shownRows: number;
  shownChangeAt: number | null;
};

type Samples = number[];

export type SmoothSummary = {
  seconds: number;
  /** Window frames submitted per second of gesture. */
  fps: number;
  frames: number;
  frameIntervalMs: Stat;
  /** Intervals between two frames that both followed a layout change: the divider or window was moving. */
  busyIntervalMs: Stat;
  /** Intervals longer than 1.5 and 3 refresh periods. */
  slowFrames: number;
  stalledFrames: number;
  /** requestAnimationFrame cadence of the page itself over the same time (display and main thread). */
  rafIntervalMs: Stat;
  refreshMs: number;
  /** Time inside the runtime's frame pass. */
  frameCostMs: Stat;
  /** Layout change of a pane to the window frame that draws it. */
  rectLagMs: Stat;
  /** First size the grid should follow to the fit that applied it. */
  gridStalenessMs: Stat;
  /** Share of the gesture during which a pane's grid differed from its fit, averaged over panes. */
  staleShare: number;
  /** From the end of the gesture until every pane's grid had the final size (-1: never within the limit). */
  settleMs: number;
  /** The first grid resizes (ms into the gesture): which pane, to what size. */
  applies: Array<{ pane: number; atMs: number; size: string }>;
  gridResizes: number;
  /** Grid resizes (each one a SIGWINCH) of the pane that had the most. */
  gridResizesMaxPane: number;
  /** Frames prepared with the cursor visible, and how many of them clipped it. */
  cursorFrames: number;
  cursorClipped: number;
  gridResizesPerS: number;
  resizeCostMs: Stat;
  holds: number;
  frozenMs: number;
  frozenMaxMs: number;
  /** Holds longer than one refresh period (a frozen pane for more than a frame). */
  frozenOverFrame: number;
  /** Fraction of the gesture, summed over panes, a pane spent frozen. */
  frozenShare: number;
  blankFrames: number;
  erasedPrompts: number;
  /** Erase to the shell's redraw. */
  redrawMs: Stat;
  /** Age of the text on screen: when its grid size was first asked for to the frame that showed it. */
  contentAgeMs: Stat;
  /** Time between two frames that showed a different grid size on the same pane. */
  reflowIntervalMs: Stat;
  /** The slowest frame intervals: when (ms into the gesture) and how long. */
  worstFrames: Array<{ atMs: number; ms: number }>;
  reallocs: Array<{
    atMs: number;
    costMs: number;
    width: number;
    height: number;
    gesture: boolean;
    area: string;
  }>;
};

type Stat = {
  n: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
};

const EMPTY: Stat = { n: 0, p50: 0, p95: 0, max: 0, mean: 0 };

function stat(values: Samples): Stat {
  if (values.length === 0) return EMPTY;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    n: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

export class SmoothProbe implements SmoothHooks {
  private recording = false;
  private startedAt = 0;
  private panes = new Map<number, PaneState>();
  private frames: Samples = [];
  private frameAts: Samples = [];
  private busyIntervals: Samples = [];
  private rectSinceFrame = false;
  private prevFrameHadRect = false;
  private contentAge: Samples = [];
  private reflowIntervals: Samples = [];
  private lastFrameAt: number | null = null;
  private frameCosts: Samples = [];
  private rectLag: Samples = [];
  private staleness: Samples = [];
  private resizeCosts: Samples = [];
  private holdStarts = new Map<number, number>();
  private holdDurations: Samples = [];
  private appliesLog: SmoothSummary["applies"] = [];
  private blankFrames = 0;
  private cursorFrames = 0;
  private cursorClipped = 0;
  private erasedAt = new Map<number, number>();
  private erased = 0;
  private redraw: Samples = [];
  private reallocs: SmoothSummary["reallocs"] = [];
  private raf: Samples = [];
  private rafHandle = 0;
  private lastRaf = 0;
  private slow = 0;
  private stalled = 0;
  private refreshMs = 1000 / 60;

  private pane(id: number): PaneState {
    let pane = this.panes.get(id);
    if (!pane) {
      pane = {
        wantCols: 0,
        wantRows: 0,
        haveCols: 0,
        haveRows: 0,
        firstWantAt: null,
        staleSince: null,
        staleMs: 0,
        applied: 0,
        rectAt: null,
        asked: new Map(),
        askedCols: 0,
        askedRows: 0,
        shownCols: 0,
        shownRows: 0,
        shownChangeAt: null,
      };
      this.panes.set(id, pane);
    }
    return pane;
  }

  /** Panes whose grid is not the size their host asks for. */
  pending(): number {
    let count = 0;
    for (const pane of this.panes.values())
      if (pane.wantCols > 0 && (pane.wantCols !== pane.haveCols || pane.wantRows !== pane.haveRows))
        count += 1;
    return count;
  }

  /** Begins recording. Grid state of known panes is kept so the first interval is not invented. */
  start(): void {
    this.recording = true;
    this.startedAt = performance.now();
    this.frames = [];
    this.frameAts = [];
    this.busyIntervals = [];
    this.rectSinceFrame = false;
    this.prevFrameHadRect = false;
    this.contentAge = [];
    this.reflowIntervals = [];
    this.lastFrameAt = null;
    this.frameCosts = [];
    this.rectLag = [];
    this.staleness = [];
    this.resizeCosts = [];
    this.holdDurations = [];
    this.holdStarts.clear();
    this.blankFrames = 0;
    this.appliesLog = [];
    this.cursorFrames = 0;
    this.cursorClipped = 0;
    this.erased = 0;
    this.redraw = [];
    this.reallocs = [];
    this.raf = [];
    this.slow = 0;
    this.stalled = 0;
    for (const pane of this.panes.values()) {
      pane.applied = 0;
      pane.staleMs = 0;
      pane.firstWantAt = null;
      pane.rectAt = null;
      pane.staleSince =
        pane.wantCols !== pane.haveCols || pane.wantRows !== pane.haveRows
          ? this.startedAt
          : null;
    }
    this.lastRaf = performance.now();
    const loop = (t: number) => {
      if (!this.recording) return;
      this.raf.push(t - this.lastRaf);
      this.lastRaf = t;
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  stop(settleMs = 0): SmoothSummary {
    const end = performance.now();
    this.recording = false;
    cancelAnimationFrame(this.rafHandle);
    const seconds = (end - this.startedAt) / 1000;
    let stale = 0;
    let resizes = 0;
    for (const pane of this.panes.values()) {
      if (pane.staleSince !== null) pane.staleMs += end - pane.staleSince;
      stale += pane.staleMs;
      resizes += pane.applied;
    }
    const active = [...this.panes.values()].filter(
      (pane) => pane.applied > 0 || pane.staleMs > 0,
    ).length;
    const duration = Math.max(1, end - this.startedAt);
    // A hold still open at the end counts up to the end.
    for (const started of this.holdStarts.values())
      this.holdDurations.push(end - started);
    this.holdStarts.clear();
    const refresh = stat(this.raf.filter((v) => v < 50)).p50 || this.refreshMs;
    this.refreshMs = refresh;
    const intervals = this.frames;
    for (const interval of intervals) {
      if (interval > refresh * 1.5) this.slow += 1;
      if (interval > refresh * 3) this.stalled += 1;
    }
    const frozen = this.holdDurations.reduce((a, b) => a + b, 0);
    return {
      seconds: Math.round(seconds * 100) / 100,
      fps: Math.round(((intervals.length + 1) / seconds) * 10) / 10,
      frames: intervals.length + 1,
      frameIntervalMs: stat(intervals),
      busyIntervalMs: stat(this.busyIntervals),
      slowFrames: this.slow,
      stalledFrames: this.stalled,
      rafIntervalMs: stat(this.raf),
      refreshMs: Math.round(refresh * 100) / 100,
      frameCostMs: stat(this.frameCosts),
      rectLagMs: stat(this.rectLag),
      gridStalenessMs: stat(this.staleness),
      staleShare: active ? Math.round((stale / duration / active) * 1000) / 1000 : 0,
      settleMs,
      applies: this.appliesLog,
      gridResizes: resizes,
      gridResizesMaxPane: Math.max(
        0,
        ...[...this.panes.values()].map((pane) => pane.applied),
      ),
      cursorFrames: this.cursorFrames,
      cursorClipped: this.cursorClipped,
      gridResizesPerS: Math.round((resizes / seconds / Math.max(1, active)) * 10) / 10,
      resizeCostMs: stat(this.resizeCosts),
      holds: this.holdDurations.length,
      frozenMs: Math.round(frozen),
      frozenMaxMs: Math.round(Math.max(0, ...this.holdDurations)),
      frozenOverFrame: this.holdDurations.filter((v) => v > refresh * 1.05)
        .length,
      frozenShare: Math.round((frozen / duration) * 1000) / 1000,
      blankFrames: this.blankFrames,
      erasedPrompts: this.erased,
      redrawMs: stat(this.redraw),
      contentAgeMs: stat(this.contentAge),
      reflowIntervalMs: stat(this.reflowIntervals),
      worstFrames: this.frames
        .map((ms, index) => ({ ms, atMs: this.frameAts[index] }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 4)
        .map((frame) => ({
          atMs: Math.round(frame.atMs),
          ms: Math.round(frame.ms),
        })),
      reallocs: this.reallocs,
    };
  }

  want(id: number, t: number, cols: number, rows: number): void {
    const pane = this.pane(id);
    pane.wantCols = cols;
    pane.wantRows = rows;
    if (cols !== pane.askedCols || rows !== pane.askedRows) {
      // The streak of this size starts now (an earlier visit to the same size is history).
      pane.askedCols = cols;
      pane.askedRows = rows;
      const key = `${cols}x${rows}`;
      pane.asked.delete(key);
      pane.asked.set(key, t);
      if (pane.asked.size > 16)
        pane.asked.delete(pane.asked.keys().next().value as string);
    }
    const same = cols === pane.haveCols && rows === pane.haveRows;
    if (same) {
      pane.firstWantAt = null;
      if (pane.staleSince !== null && this.recording)
        pane.staleMs += t - pane.staleSince;
      pane.staleSince = null;
      return;
    }
    pane.firstWantAt ??= t;
    pane.staleSince ??= t;
  }

  have(
    id: number,
    t: number,
    cols: number,
    rows: number,
    applied: boolean,
    costMs: number,
  ): void {
    const pane = this.pane(id);
    pane.haveCols = cols;
    pane.haveRows = rows;
    if (applied && this.recording) {
      pane.applied += 1;
      if (this.appliesLog.length < 12)
        this.appliesLog.push({
          pane: id,
          atMs: Math.round(t - this.startedAt),
          size: `${cols}x${rows}`,
        });
      this.resizeCosts.push(costMs);
      if (pane.firstWantAt !== null) this.staleness.push(t - pane.firstWantAt);
    }
    const same = pane.wantCols === cols && pane.wantRows === rows;
    pane.firstWantAt = same ? null : t;
    if (same) {
      if (pane.staleSince !== null && this.recording)
        pane.staleMs += t - pane.staleSince;
      pane.staleSince = null;
    } else pane.staleSince ??= t;
  }

  rect(id: number, t: number): void {
    this.rectSinceFrame = true;
    const pane = this.pane(id);
    pane.rectAt ??= t;
  }

  unchanged(id: number): void {
    this.pane(id).rectAt = null;
  }

  drawn(id: number, t: number): void {
    const pane = this.pane(id);
    if (pane.rectAt !== null) {
      if (this.recording) this.rectLag.push(t - pane.rectAt);
      pane.rectAt = null;
    }
  }

  frame(t: number, costMs: number): void {
    if (!this.recording) return;
    if (this.lastFrameAt !== null) {
      this.frames.push(t - this.lastFrameAt);
      this.frameAts.push(t - this.startedAt);
      if (this.rectSinceFrame && this.prevFrameHadRect)
        this.busyIntervals.push(t - this.lastFrameAt);
    }
    this.prevFrameHadRect = this.rectSinceFrame;
    this.rectSinceFrame = false;
    this.lastFrameAt = t;
    this.frameCosts.push(costMs);
  }

  hold(instance: number, start: boolean, t: number): void {
    if (!this.recording) return;
    if (start) this.holdStarts.set(instance, t);
    else {
      const started = this.holdStarts.get(instance);
      if (started !== undefined) {
        this.holdDurations.push(t - started);
        this.holdStarts.delete(instance);
      }
    }
  }

  cleared(instance: number, erased: boolean, t: number): void {
    if (erased) {
      this.erasedAt.set(instance, t);
      if (this.recording) this.erased += 1;
      return;
    }
    const at = this.erasedAt.get(instance);
    if (at === undefined) return;
    this.erasedAt.delete(instance);
    if (this.recording) this.redraw.push(t - at);
  }

  cursor(_pane: number, onScreen: boolean): void {
    if (!this.recording) return;
    this.cursorFrames += 1;
    if (!onScreen) this.cursorClipped += 1;
  }

  blank(_pane: number, _t: number): void {
    if (this.recording) this.blankFrames += 1;
  }

  shown(id: number, t: number, cols: number, rows: number): void {
    if (!this.recording) return;
    const pane = this.pane(id);
    const asked = pane.asked.get(`${cols}x${rows}`);
    if (asked !== undefined) this.contentAge.push(t - asked);
    if (cols !== pane.shownCols || rows !== pane.shownRows) {
      if (pane.shownChangeAt !== null && pane.shownCols > 0)
        this.reflowIntervals.push(t - pane.shownChangeAt);
      pane.shownCols = cols;
      pane.shownRows = rows;
      pane.shownChangeAt = t;
    }
  }

  realloc(
    t: number,
    costMs: number,
    width: number,
    height: number,
    gesture: boolean,
    area: string,
  ): void {
    if (!this.recording) return;
    this.reallocs.push({
      atMs: Math.round(t - this.startedAt),
      costMs: Math.round(costMs * 100) / 100,
      width,
      height,
      gesture,
      area,
    });
  }
}

export function installSmoothProbe(): SmoothProbe {
  const g = globalThis as unknown as Record<string, SmoothProbe | undefined>;
  g[SMOOTH_KEY] ??= new SmoothProbe();
  return g[SMOOTH_KEY] as SmoothProbe;
}
