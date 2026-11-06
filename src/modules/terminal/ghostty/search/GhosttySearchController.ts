import type { TerminalSearchController } from "@/modules/terminal/search/TerminalSearchController";
import type { GhosttyTerminalModelApi } from "../GhosttyTerminalModel";
import type {
  GhosttySearchEngine,
  GhosttySearchSnapshot,
} from "./GhosttySearchEngine";

export type { GhosttySearchSnapshot };

type Task = (search: GhosttySearchEngine) => void;

const IDLE: GhosttySearchSnapshot = { query: "", pendingDirection: null };

/**
 * What every surface owns as its search controller. The engine behind it
 * (`GhosttySearchEngine`, about 1 kB gzipped) loads on the first find, a restored
 * query or a highlighted block search, because almost no terminal ever searches.
 * The latest request made while it loads is replayed when it arrives; that find
 * returns false, which nothing reads.
 */
export class GhosttySearchController implements TerminalSearchController {
  private search: GhosttySearchEngine | null = null;
  private queued: Task | null = null;
  private loading = false;
  private suspended = false;
  private disposed = false;

  constructor(
    private readonly model: GhosttyTerminalModelApi,
    private readonly onChange: () => void,
  ) {}

  findNext(query: string): boolean {
    if (this.search) return this.search.findNext(query);
    return this.defer(query !== "" && !this.suspended, (s) =>
      s.findNext(query),
    );
  }

  findPrevious(query: string): boolean {
    if (this.search) return this.search.findPrevious(query);
    return this.defer(query !== "" && !this.suspended, (s) =>
      s.findPrevious(query),
    );
  }

  snapshot(): GhosttySearchSnapshot {
    return this.search?.snapshot() ?? IDLE;
  }

  restore(snapshot: GhosttySearchSnapshot): void {
    if (this.search) this.search.restore(snapshot);
    else this.defer(snapshot.query !== "", (s) => s.restore(snapshot));
  }

  suspend(): void {
    this.suspended = true;
    this.search?.suspend();
  }

  resume(): void {
    this.suspended = false;
    this.search?.resume();
  }

  clearDecorations(): void {
    if (this.search) {
      this.search.clearDecorations();
    } else if (!this.disposed) {
      this.queued = null;
      this.model.clearSearch();
      this.onChange();
    }
  }

  refreshOverlay(): void {
    if (this.search) this.search.refreshOverlay();
    else this.defer(!!this.model.blockSearchActive?.(), () => {});
  }

  get maskRevision(): number {
    return this.search?.maskRevision ?? 0;
  }

  viewportMaskBytes(): Uint8Array | null {
    return this.search?.viewportMaskBytes() ?? null;
  }

  invalidate(): void {
    this.search?.invalidate();
  }

  matchAt(row: number, column: number): 0 | 1 | 2 {
    return this.search?.matchAt(row, column) ?? 0;
  }

  dispose(): void {
    this.disposed = true;
    this.queued = null;
    this.search?.dispose();
  }

  /** Queues `task` for the real controller and loads it; returns false. */
  private defer(wanted: boolean, task: Task): false {
    if (wanted && !this.disposed) {
      this.queued = task;
      if (!this.loading) this.load();
    }
    return false;
  }

  private load(): void {
    this.loading = true;
    import("./GhosttySearchEngine").then(
      ({ GhosttySearchEngine }) => {
        if (this.disposed) return;
        const search = new GhosttySearchEngine(this.model, this.onChange);
        this.search = search;
        // In the order the calls were made: a find, then a suspension.
        this.queued?.(search);
        this.queued = null;
        if (this.suspended) search.suspend();
        search.refreshOverlay();
        this.onChange();
      },
      (error) => {
        this.loading = false;
        console.error("[terax] terminal search failed to load", error);
      },
    );
  }
}
