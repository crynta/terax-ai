import type { TerminalSearchController } from "@/modules/terminal/search/TerminalSearchController";
import type {
  GhosttySearchStatus,
  GhosttyTerminalModelApi,
} from "../GhosttyTerminalModel";

const SEARCH_STEP_BUDGET = 256;

type Direction = "next" | "previous";

export type GhosttySearchSnapshot = {
  readonly query: string;
  readonly pendingDirection: Direction | null;
};

type Scheduler = {
  readonly request: (callback: () => void) => number;
  readonly cancel: (handle: number) => void;
};

export class GhosttySearchController implements TerminalSearchController {
  private query = "";
  private status: GhosttySearchStatus = emptyStatus();
  private viewportMask: Uint8Array = new Uint8Array(0);
  private scratchMask: Uint8Array = new Uint8Array(0);
  private maskCells = 0;
  private maskRevisionValue = 0;
  private pendingDirection: Direction | null = null;
  private scheduledStep: number | null = null;
  private disposed = false;
  private suspended = false;

  constructor(
    private readonly model: GhosttyTerminalModelApi,
    private readonly onChange: () => void,
    private readonly scheduler: Scheduler = browserScheduler(),
  ) {}

  findNext(query: string): boolean {
    return this.find(query, "next");
  }

  findPrevious(query: string): boolean {
    return this.find(query, "previous");
  }

  snapshot(): GhosttySearchSnapshot {
    return { query: this.query, pendingDirection: this.pendingDirection };
  }

  restore(snapshot: GhosttySearchSnapshot): void {
    if (this.disposed) return;
    this.cancelStep();
    this.query = snapshot.query;
    this.pendingDirection = snapshot.pendingDirection;
    this.refresh();
  }

  suspend(): void {
    this.suspended = true;
    this.cancelStep();
  }

  resume(): void {
    this.suspended = false;
    this.refresh();
  }

  clearDecorations(): void {
    if (this.disposed) return;
    this.cancelStep();
    this.query = "";
    this.pendingDirection = null;
    this.model.clearSearch();
    this.status = emptyStatus();
    this.commitMask(new Uint8Array(0), 0);
    this.onChange();
  }

  refreshOverlay(): void {
    if (this.disposed || this.suspended || this.query) return;
    if (this.model.blockSearchActive?.()) this.rebuildViewportMask();
    else if (this.viewportMask.length) this.commitMask(new Uint8Array(0), 0);
  }

  /** Increments only when the set of highlighted cells actually changes. */
  get maskRevision(): number {
    return this.maskRevisionValue;
  }

  /**
   * One byte per viewport cell (0 none, 1 match, 2 selected match), row-major,
   * or null when nothing is highlighted. Borrowed: valid until the next change.
   */
  viewportMaskBytes(): Uint8Array | null {
    return this.maskCells > 0 ? this.viewportMask : null;
  }

  refresh(): void {
    if (this.disposed) return;
    if (!this.query) {
      this.refreshOverlay();
      return;
    }
    this.step();
  }

  invalidate(): void {
    if (!this.disposed && !this.suspended && this.query) this.scheduleStep();
  }

  matchAt(row: number, column: number): 0 | 1 | 2 {
    if (
      row < 0 ||
      row >= this.model.rows ||
      column < 0 ||
      column >= this.model.cols
    ) {
      return 0;
    }
    return (this.viewportMask[row * this.model.cols + column] ?? 0) as
      | 0
      | 1
      | 2;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelStep();
    this.viewportMask = new Uint8Array(0);
    this.scratchMask = new Uint8Array(0);
    this.maskCells = 0;
    this.maskRevisionValue += 1;
  }

  private find(query: string, direction: Direction): boolean {
    if (this.disposed || this.suspended || query.length === 0) return false;
    if (query !== this.query) {
      this.cancelStep();
      this.query = query;
      this.status = this.model.setSearchQuery(query);
    }
    this.pendingDirection = direction;
    this.step();
    return this.status.totalMatches > 0;
  }

  private step(): void {
    if (this.disposed || this.suspended || !this.query) return;
    this.status = this.model.stepSearch(SEARCH_STEP_BUDGET);
    if (
      this.status.complete &&
      this.status.totalMatches > 0 &&
      this.pendingDirection
    ) {
      const direction = this.pendingDirection;
      this.pendingDirection = null;
      this.status = this.model.selectSearchMatch(direction);
    }
    this.rebuildViewportMask();
    this.onChange();
    if (!this.status.complete) this.scheduleStep();
    else this.cancelStep();
  }

  private rebuildViewportMask(): void {
    const length = this.model.cols * this.model.rows;
    if (this.scratchMask.length !== length) {
      this.scratchMask = new Uint8Array(length);
    } else {
      this.scratchMask.fill(0);
    }
    let cells = 0;
    for (const match of this.model.searchViewportMatches()) {
      if (match.row < 0 || match.row >= this.model.rows) continue;
      const start = Math.max(0, Math.min(this.model.cols, match.startColumn));
      const end = Math.max(start, Math.min(this.model.cols, match.endColumn));
      this.scratchMask.fill(
        match.selected ? 2 : 1,
        match.row * this.model.cols + start,
        match.row * this.model.cols + end,
      );
      cells += end - start;
    }
    this.commitMask(this.scratchMask, cells);
  }

  /** Installs `next` when it differs; returns true if `next` was adopted. */
  private commitMask(next: Uint8Array, cells: number): boolean {
    const current = this.viewportMask;
    let same = next.length === current.length;
    for (let index = 0; same && index < next.length; index += 1) {
      same = next[index] === current[index];
    }
    if (same) return false;
    if (next === this.scratchMask) this.scratchMask = current;
    this.viewportMask = next;
    this.maskCells = cells;
    this.maskRevisionValue += 1;
    return true;
  }

  private scheduleStep(): void {
    if (this.scheduledStep !== null) return;
    this.scheduledStep = this.scheduler.request(() => {
      this.scheduledStep = null;
      this.step();
    });
  }

  private cancelStep(): void {
    if (this.scheduledStep !== null) {
      this.scheduler.cancel(this.scheduledStep);
    }
    this.scheduledStep = null;
  }
}

function emptyStatus(): GhosttySearchStatus {
  return {
    active: false,
    pending: false,
    complete: true,
    generation: 0,
    totalMatches: 0,
    selectedIndex: -1,
  };
}

function browserScheduler(): Scheduler {
  return {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  };
}
