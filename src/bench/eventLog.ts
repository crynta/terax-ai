/**
 * Timestamped page events of the app lab (`scenario.instrument`): what the page itself does while
 * "nothing" happens. A step in the WebContent footprint at minute two or three of an idle run is
 * explained by whatever the page did just before it: a canvas reallocated, a resize observer fired,
 * a long timer elapsed, an IPC call, a focus change. The log is a bounded ring; every sample drains
 * it into the report. Also counts the listeners that stay registered on long-lived targets (window,
 * document), which is where a leaking subscription would show.
 */
export type LogEntry = { t: number; k: string; v?: unknown };

const MAX_ENTRIES = 800;
const entries: LogEntry[] = [];
let dropped = 0;
const listeners = new Map<string, number>();
const registered = new WeakMap<object, Map<string, Set<unknown>>>();
let installed = false;

const now = () => Math.round(performance.now());

function logEvent(k: string, v?: unknown): void {
  if (entries.length >= MAX_ENTRIES) {
    entries.shift();
    dropped++;
  }
  entries.push(v === undefined ? { t: now(), k } : { t: now(), k, v });
}

/** The entries since the last call, and the number lost to the ring since then. */
export function drainEventLog(): { events: LogEntry[]; dropped: number } {
  const events = entries.splice(0, entries.length);
  const lost = dropped;
  dropped = 0;
  return { events, dropped: lost };
}

/** Net registrations (add minus remove) on window, document and the root elements by event type. */
export function listenerCensus(): Record<string, number> {
  return Object.fromEntries(
    [...listeners].filter(([, count]) => count !== 0).sort(),
  );
}

const IGNORED_IPC = new Set(["bench_window", "pty_ack"]);

export function logIpc(command: string): void {
  if (installed && !IGNORED_IPC.has(command)) logEvent(`ipc:${command}`);
}

/** Frames of an error stack that are not this file, shortened (release builds are minified). */
function caller(): string {
  const lines = (new Error().stack ?? "").split("\n").slice(3, 6);
  return lines
    .map((line) => line.replace(/^.*?@/, "").replace(/^.*\//, ""))
    .join(" < ");
}

export function installEventLog(): void {
  if (installed) return;
  installed = true;
  try {
    install();
  } catch (error) {
    console.error("[bench] event log partially installed:", error);
  }
}

function install(): void {
  for (const type of ["resize", "focus", "blur", "pageshow", "pagehide"])
    window.addEventListener(type, () => logEvent(`window:${type}`), true);
  document.addEventListener(
    "visibilitychange",
    () => logEvent("document:visibilitychange", document.visibilityState),
    true,
  );
  document.addEventListener("fullscreenchange", () => logEvent("fullscreen"));

  // Canvas backing store changes.
  for (const dimension of ["width", "height"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      dimension,
    );
    if (!descriptor?.set) continue;
    const set = descriptor.set;
    Object.defineProperty(HTMLCanvasElement.prototype, dimension, {
      ...descriptor,
      set(this: HTMLCanvasElement, value: number) {
        logEvent(`canvas.${dimension}=`, value);
        set.call(this, value);
      },
    });
  }
  const context = (
    globalThis as unknown as {
      GPUCanvasContext?: { prototype: Record<string, unknown> };
    }
  ).GPUCanvasContext;
  for (const name of ["configure", "unconfigure"]) {
    const original = context?.prototype[name] as
      | ((...args: unknown[]) => unknown)
      | undefined;
    if (!context || !original) continue;
    context.prototype[name] = function (this: unknown, ...args: unknown[]) {
      logEvent(`gpuCanvas.${name}`);
      return original.apply(this, args);
    };
  }

  // Resize observers: which element, how big.
  const NativeObserver = window.ResizeObserver;
  if (NativeObserver) {
    window.ResizeObserver = class extends NativeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((records, observer) => {
          for (const record of records) {
            const target = record.target as HTMLElement;
            logEvent("resizeObserver", {
              el: target.hasAttribute?.("data-terminal-area")
                ? "terminal-area"
                : `${target.tagName}.${String(target.className).slice(0, 40)}`,
              w: Math.round(record.contentRect.width),
              h: Math.round(record.contentRect.height),
            });
          }
          callback(records, observer);
        });
      }
    };
  }

  // Timers long enough to matter for an idle page (scheduled, with the caller).
  const timeout = window.setTimeout.bind(window);
  window.setTimeout = ((
    handler: TimerHandler,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (Number(delay) >= 1000)
      logEvent("setTimeout", { ms: Number(delay), by: caller() });
    return timeout(handler, delay, ...args);
  }) as typeof window.setTimeout;
  const idle = window.requestIdleCallback?.bind(window);
  if (idle) {
    window.requestIdleCallback = ((
      cb: IdleRequestCallback,
      opts?: IdleRequestOptions,
    ) => {
      logEvent("requestIdleCallback", { by: caller() });
      return idle(cb, opts);
    }) as typeof window.requestIdleCallback;
  }

  // Listener census on the long-lived targets.
  const longLived = (target: unknown) =>
    target === window ||
    target === document ||
    target === document.documentElement ||
    target === document.body;
  const label = (target: unknown) =>
    target === window
      ? "window"
      : target === document
        ? "document"
        : target === document.documentElement
          ? "html"
          : "body";
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (listener && longLived(this)) {
      const capture =
        typeof options === "boolean" ? options : Boolean(options?.capture);
      const key = `${type}|${capture}`;
      const map = registered.get(this) ?? new Map<string, Set<unknown>>();
      registered.set(this, map);
      const set = map.get(key) ?? new Set<unknown>();
      map.set(key, set);
      if (!set.has(listener)) {
        set.add(listener);
        const name = `${label(this)}:${type}`;
        listeners.set(name, (listeners.get(name) ?? 0) + 1);
      }
    }
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    if (listener && longLived(this)) {
      const capture =
        typeof options === "boolean" ? options : Boolean(options?.capture);
      const set = registered.get(this)?.get(`${type}|${capture}`);
      if (set?.delete(listener)) {
        const name = `${label(this)}:${type}`;
        listeners.set(name, (listeners.get(name) ?? 0) - 1);
      }
    }
    return remove.call(this, type, listener, options);
  };
}
