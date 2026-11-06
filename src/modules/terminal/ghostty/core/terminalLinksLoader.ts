import type { LazyTerminalLinksOptions } from "./LazyTerminalLinks";

/** A queued click only belongs to the content and geometry it was made on. */
export function terminalLinkReplayStamp(
  options: LazyTerminalLinksOptions,
): string {
  const rect = options.target.getBoundingClientRect();
  const geometry = options.geometry();
  return [
    options.model.revision(),
    options.model.viewportOriginLine(),
    rect.left,
    rect.top,
    rect.width,
    rect.height,
    geometry.cellWidth,
    geometry.cellHeight,
    geometry.shiftY,
  ].join(",");
}

export interface DeferredTerminalLinks {
  invalidate(): void;
  dispose(): void;
}

/**
 * Brings in the link trigger (`LazyTerminalLinks`) once the surface exists:
 * hovering a link is not needed to draw or stream the first terminal, so none
 * of its code belongs to the chunk that does.
 */
export function deferTerminalLinks(
  options: LazyTerminalLinksOptions,
): DeferredTerminalLinks {
  let links: DeferredTerminalLinks | null = null;
  let disposed = false;
  const events: Event[] = [];
  let clickStamp: string | null = null;
  const types = [
    "pointermove",
    "pointerdown",
    "pointerup",
    "pointerleave",
    "pointercancel",
    "keydown",
    "keyup",
    "blur",
  ];
  const capture = (event: Event) => {
    if (event.type === "pointerdown" && clickStamp === null)
      clickStamp = terminalLinkReplayStamp(options);
    if (
      event.type === "pointermove" &&
      events[events.length - 1]?.type === "pointermove"
    )
      events.pop();
    events.push(event);
    if (events.length > 64) events.shift();
  };
  const listen = (add: boolean) => {
    for (const type of types) {
      const target = type.startsWith("pointer")
        ? options.target
        : options.keyTarget;
      if (add) target.addEventListener(type, capture);
      else target.removeEventListener(type, capture);
    }
  };
  listen(true);
  const loaded = import("./LazyTerminalLinks").then(({ LazyTerminalLinks }) => {
    if (disposed) return;
    const trigger = new LazyTerminalLinks(options);
    links = trigger;
    listen(false);
    const stale =
      clickStamp !== null && clickStamp !== terminalLinkReplayStamp(options);
    for (const event of events) {
      if (stale && (event.type === "pointerdown" || event.type === "pointerup"))
        continue;
      trigger.ingest(event);
    }
    events.length = 0;
  });
  loaded.catch((error) => {
    listen(false);
    events.length = 0;
    console.error(error);
  });
  return {
    invalidate: () => links?.invalidate(),
    dispose: () => {
      disposed = true;
      listen(false);
      events.length = 0;
      links?.dispose();
      links = null;
    },
  };
}
