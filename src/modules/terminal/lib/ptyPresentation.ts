import { invoke } from "@tauri-apps/api/core";

/**
 * How urgently a terminal's output is wanted. Native uses it to pick a
 * coalescing deadline (4 ms focused, 16 ms visible, 100 ms hidden, 250 ms when
 * the window is occluded), so background terminals cost a fraction of the IPC
 * of the one being typed into. macOS reports window occlusion and sleep
 * natively; the document's own visibility covers the other platforms.
 */
export type PtyPresentationClass =
  | "focused"
  | "visible"
  | "hidden"
  | "occluded";

type Leaf = { visible: boolean; focused: boolean; pty: number | null };

/**
 * `seq` grows with every request. Native runs commands on several threads, so
 * two reports can be applied out of order; a terminal keeps the class of the
 * highest `seq` that named it.
 */
type Send = (
  ids: number[],
  presentation: PtyPresentationClass,
  seq: number,
) => Promise<unknown>;

export class PtyPresentationReporter {
  private readonly leaves = new Map<number, Leaf>();
  /** What native currently believes, per PTY. */
  private readonly reported = new Map<number, PtyPresentationClass>();
  private scheduled = false;
  private stopWatching: (() => void) | null = null;
  private requests = 0;
  private seq = 0;

  constructor(
    private readonly send: Send,
    private readonly windowHidden: () => boolean = documentHidden,
    private readonly watchWindow: (
      listener: () => void,
    ) => () => void = watchDocument,
  ) {}

  /** The class a terminal of this leaf is in right now. */
  classFor(leafId: number): PtyPresentationClass {
    if (this.windowHidden()) return "occluded";
    const leaf = this.leaves.get(leafId);
    if (!leaf) return "focused";
    return leaf.visible ? (leaf.focused ? "focused" : "visible") : "hidden";
  }

  setLeaf(leafId: number, visible: boolean, focused: boolean): void {
    const leaf = this.leaves.get(leafId);
    if (leaf) {
      if (leaf.visible === visible && leaf.focused === focused) return;
      leaf.visible = visible;
      leaf.focused = focused;
    } else {
      this.leaves.set(leafId, { visible, focused, pty: null });
    }
    this.schedule();
  }

  /** A PTY opened for this leaf, already told to start as `openedAs`. */
  bind(leafId: number, ptyId: number, openedAs: PtyPresentationClass): void {
    const leaf = this.leaves.get(leafId) ?? {
      visible: true,
      focused: true,
      pty: null,
    };
    this.leaves.set(leafId, leaf);
    leaf.pty = ptyId;
    this.reported.set(ptyId, openedAs);
    this.stopWatching ??= this.watchWindow(() => this.schedule());
    this.schedule();
  }

  unbind(leafId: number, ptyId: number): void {
    this.reported.delete(ptyId);
    const leaf = this.leaves.get(leafId);
    if (leaf?.pty === ptyId) leaf.pty = null;
    if (this.reported.size === 0) {
      this.stopWatching?.();
      this.stopWatching = null;
    }
  }

  /** The leaf itself is gone (tab closed), not merely respawning. */
  forget(leafId: number): void {
    const leaf = this.leaves.get(leafId);
    if (leaf && leaf.pty !== null) this.unbind(leafId, leaf.pty);
    this.leaves.delete(leafId);
  }

  diagnostics() {
    return {
      leaves: this.leaves.size,
      bound: this.reported.size,
      requests: this.requests,
    };
  }

  dispose(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.leaves.clear();
    this.reported.clear();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.flush();
    });
  }

  /** Sends one batch per class, and only for terminals whose class changed. */
  private flush(): void {
    const batches = new Map<PtyPresentationClass, number[]>();
    for (const [leafId, leaf] of this.leaves) {
      if (leaf.pty === null) continue;
      const wanted = this.classFor(leafId);
      if (this.reported.get(leaf.pty) === wanted) continue;
      this.reported.set(leaf.pty, wanted);
      const ids = batches.get(wanted);
      if (ids) ids.push(leaf.pty);
      else batches.set(wanted, [leaf.pty]);
    }
    for (const [presentation, ids] of batches) {
      this.requests++;
      this.send(ids, presentation, ++this.seq).catch((error: unknown) => {
        // The cadence is an optimisation: forget the claim so the next change
        // re-sends, but never surface an error for it.
        for (const id of ids)
          if (this.reported.get(id) === presentation) this.reported.delete(id);
        console.debug("[terax] pty_set_presentation failed:", error);
      });
    }
  }
}

function documentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

function watchDocument(listener: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

let reporter: PtyPresentationReporter | null = null;

function instance(): PtyPresentationReporter {
  reporter ??= new PtyPresentationReporter((ids, presentation, seq) =>
    invoke("pty_set_presentation", { ids, class: presentation, seq }),
  );
  return reporter;
}

/** Pane visibility and focus, as known to the terminal session. */
export function setLeafPresentation(
  leafId: number,
  visible: boolean,
  focused: boolean,
): void {
  instance().setLeaf(leafId, visible, focused);
}

export function leafPresentationClass(leafId: number): PtyPresentationClass {
  return instance().classFor(leafId);
}

export function bindLeafPty(
  leafId: number,
  ptyId: number,
  openedAs: PtyPresentationClass,
): void {
  instance().bind(leafId, ptyId, openedAs);
}

export function unbindLeafPty(leafId: number, ptyId: number): void {
  reporter?.unbind(leafId, ptyId);
}

export function forgetLeafPresentation(leafId: number): void {
  reporter?.forget(leafId);
}

export function ptyPresentationDiagnostics() {
  return reporter?.diagnostics() ?? null;
}
