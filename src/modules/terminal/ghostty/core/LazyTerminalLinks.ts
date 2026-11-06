import type { GhosttyTerminalModelApi } from "../GhosttyTerminalModel";
import type { LinkUnderlineGeometry } from "./LinkUnderlineOverlay";
import type { TerminalLinkHit } from "./terminalLinks";
import { terminalLinkReplayStamp } from "./terminalLinksLoader";

export type LazyTerminalLinksOptions = {
  readonly target: HTMLElement;
  readonly keyTarget: Pick<Window, "addEventListener" | "removeEventListener">;
  /** Whether the platform's link modifier (Cmd, or Ctrl elsewhere) is down. */
  readonly isModifier: (event: {
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
  }) => boolean;
  readonly model: Pick<
    GhosttyTerminalModelApi,
    "linkSource" | "cols" | "rows" | "modes" | "revision" | "viewportOriginLine"
  >;
  /** The pane's scrollbar; the pointer over it belongs to the scrollbar. */
  readonly scrollbar: Node;
  readonly geometry: () => LinkUnderlineGeometry;
  readonly onActivate: (hit: TerminalLinkHit) => void;
};

/** What the lazily loaded link machinery offers its owner. */
export interface ActiveTerminalLinks {
  /** Takes over a pointer or key event that happened while this loaded. */
  ingest(event: Event): void;
  invalidate(): void;
  dispose(): void;
}

const MAX_QUEUED_EVENTS = 64;

/**
 * Link hover and activation, loaded on demand. A terminal that never sees the
 * link modifier pays for a few listeners; the detection, hit-testing,
 * underline and activation code arrives with the first modified pointer
 * movement, press or key press, and takes over the events that happened while
 * it loaded, so the first Cmd/Ctrl-click does not need a second one.
 *
 * Everything lives in the constructor's closure: this class is part of the
 * first terminal's chunk, and closure variables minify where members do not.
 */
export class LazyTerminalLinks {
  readonly ingest: (event: Event) => void;
  /** The cells under the pointer changed meaning (output, scroll). */
  readonly invalidate: () => void;
  readonly dispose: () => void;

  constructor(options: LazyTerminalLinksOptions) {
    const { target, keyTarget, isModifier } = options;
    let active: ActiveTerminalLinks | null = null;
    // Non-null exactly while the code loads: what happened meanwhile.
    let queue: Event[] | null = null;
    // The latest pointer event over the pane; null once the pointer left.
    let last: PointerEvent | null = null;
    let keysBound = false;
    let hearing = false;
    let disposed = false;
    let clickStamp: string | null = null;

    const push = (event: Event): void => {
      if (event.type === "pointerdown" && clickStamp === null)
        clickStamp = terminalLinkReplayStamp(options);
      queue?.push(event);
      if (queue && queue.length > MAX_QUEUED_EVENTS) queue.shift();
    };

    const bindKeys = (on: boolean): void => {
      if (on === keysBound) return;
      keysBound = on;
      if (on) keyTarget.addEventListener("keydown", onKey);
      else keyTarget.removeEventListener("keydown", onKey);
    };

    // Releases are only worth hearing while a press may wait for the code.
    const hear = (on: boolean): void => {
      if (on === hearing) return;
      hearing = on;
      if (on) {
        target.addEventListener("pointerup", onRelease);
        keyTarget.addEventListener("keyup", onKey);
        keyTarget.addEventListener("blur", onLeave);
      } else {
        target.removeEventListener("pointerup", onRelease);
        keyTarget.removeEventListener("keyup", onKey);
        keyTarget.removeEventListener("blur", onLeave);
      }
    };

    const onPointer = (event: PointerEvent): void => {
      if (event.pointerType === "touch") return;
      if (event.type === "pointerdown" && event.button) return;
      last = event;
      if (queue) {
        push(event);
        return;
      }
      bindKeys(true);
      if (isModifier(event)) void load([event]);
    };

    const onRelease = (event: PointerEvent): void => {
      if (last) push(event);
    };

    const onKey = (event: KeyboardEvent): void => {
      if (!last) return;
      if (queue) push(event);
      else if (isModifier(event)) void load([last, event]);
    };

    // Nothing that happened before the pointer left is worth replaying, and a
    // key press elsewhere must not load links for a pane it is not over.
    const onLeave = (): void => {
      last = null;
      if (queue) queue.length = 0;
      clickStamp = null;
      bindKeys(false);
    };

    const detach = (): void => {
      target.removeEventListener("pointermove", onPointer);
      target.removeEventListener("pointerdown", onPointer);
      target.removeEventListener("pointerleave", onLeave);
      target.removeEventListener("pointercancel", onLeave);
      bindKeys(false);
      hear(false);
    };

    const load = async (seed: Event[]): Promise<void> => {
      if (active || queue || disposed) return;
      queue = seed;
      if (seed.some((event) => event.type === "pointerdown"))
        clickStamp = terminalLinkReplayStamp(options);
      hear(true);
      try {
        const { createTerminalLinks } = await import("./terminalLinksRuntime");
        if (disposed) return;
        const links = createTerminalLinks(options);
        active = links;
        const pending = queue ?? [];
        detach();
        last = null;
        const stale =
          clickStamp !== null &&
          clickStamp !== terminalLinkReplayStamp(options);
        for (const event of pending) {
          if (
            stale &&
            (event.type === "pointerdown" || event.type === "pointerup")
          )
            continue;
          links.ingest(event);
        }
      } catch (error) {
        console.error("[terax] terminal link support failed to load:", error);
      } finally {
        queue = null;
        clickStamp = null;
        if (!active) hear(false);
      }
    };

    target.addEventListener("pointermove", onPointer);
    target.addEventListener("pointerdown", onPointer);
    target.addEventListener("pointerleave", onLeave);
    target.addEventListener("pointercancel", onLeave);

    this.ingest = (event) => {
      if (active) return active.ingest(event);
      if (event.type === "pointermove" || event.type === "pointerdown")
        onPointer(event as PointerEvent);
      else if (event.type === "pointerup") onRelease(event as PointerEvent);
      else if (event.type === "keydown" || event.type === "keyup")
        onKey(event as KeyboardEvent);
      else onLeave();
    };
    this.invalidate = () => active?.invalidate();
    this.dispose = () => {
      if (disposed) return;
      disposed = true;
      detach();
      active?.dispose();
      active = null;
      last = null;
      queue = null;
    };
  }
}
