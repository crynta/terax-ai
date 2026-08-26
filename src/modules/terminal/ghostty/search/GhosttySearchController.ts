import type { TerminalSearchController } from "@/modules/terminal/search/TerminalSearchController";
import type {
  GhosttySearchStatus,
  GhosttyTerminalModelApi,
} from "../GhosttyTerminalModel";

const SEARCH_STEP_BUDGET = 256;

type Direction = "next" | "previous";

type Scheduler = {
  readonly request: (callback: () => void) => number;
  readonly cancel: (handle: number) => void;
};

export class GhosttySearchController implements TerminalSearchController {
  private query = "";
  private status: GhosttySearchStatus = emptyStatus();
  private viewportMask = new Uint8Array(0);
  private pendingDirection: Direction | null = null;
  private scheduledStep: number | null = null;
  private disposed = false;

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

  clearDecorations(): void {
    if (this.disposed) return;
    this.cancelStep();
    this.query = "";
    this.pendingDirection = null;
    this.model.clearSearch();
    this.status = emptyStatus();
    this.viewportMask.fill(0);
    this.onChange();
  }

  refresh(): void {
    if (this.disposed || !this.query) return;
    this.step();
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
  }

  private find(query: string, direction: Direction): boolean {
    if (this.disposed || query.length === 0) return false;
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
    if (this.disposed || !this.query) return;
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
  }

  private rebuildViewportMask(): void {
    const length = this.model.cols * this.model.rows;
    if (this.viewportMask.length !== length) {
      this.viewportMask = new Uint8Array(length);
    } else {
      this.viewportMask.fill(0);
    }
    for (const match of this.model.searchViewportMatches()) {
      if (match.row < 0 || match.row >= this.model.rows) continue;
      const start = Math.max(0, Math.min(this.model.cols, match.startColumn));
      const end = Math.max(start, Math.min(this.model.cols, match.endColumn));
      this.viewportMask.fill(
        match.selected ? 2 : 1,
        match.row * this.model.cols + start,
        match.row * this.model.cols + end,
      );
    }
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
