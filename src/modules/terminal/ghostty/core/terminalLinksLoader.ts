import type { LazyTerminalLinksOptions } from "./LazyTerminalLinks";

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
    for (const event of events) trigger.ingest(event);
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
