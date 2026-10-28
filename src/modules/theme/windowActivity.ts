// "Is anyone looking at this window?" - one answer for the whole webview.
//
// A window that is unfocused, hidden, minimized or fully occluded displays
// nothing the user is watching, so work that only exists to animate pixels
// should stop. Consumers:
//   - CSS: `html[data-window-inactive]` pauses every CSS animation
//     (see globals.css), so spinners, shimmer and pulses stop producing frames;
//   - JS: `useWindowInactive()` / `subscribeWindowInactive()` for things CSS
//     cannot pause (animated background images).
//
// Pure derivation + injected sources keep this testable; the native occlusion
// feed is subscribed from the terminal's shared presentation tracker rather than
// listened to again.

export const WINDOW_INACTIVE_ATTR = "data-window-inactive";

type WindowActivityInputs = {
  /** The webview has OS focus. */
  focused: boolean;
  /** `document.visibilityState === "visible"`. */
  documentVisible: boolean;
  /** Native presentation (occlusion / sleep) says the window can be seen. */
  presentationVisible: boolean;
};

export function isWindowInactive(inputs: WindowActivityInputs): boolean {
  return !(
    inputs.focused &&
    inputs.documentVisible &&
    inputs.presentationVisible
  );
}

type Unsubscribe = () => void;

export type WindowActivitySources = {
  root: Pick<Element, "setAttribute" | "removeAttribute">;
  doc: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >;
  /** Reports OS focus changes. Not called with the initial state. */
  bindFocus: (listener: (focused: boolean) => void) => Unsubscribe;
  /** Shared native presentation feed; omitted where none exists (Settings). */
  subscribePresentation?: (
    listener: (state: { readonly visible: boolean }) => void,
  ) => Unsubscribe;
};

let inactive = false;
const listeners = new Set<() => void>();

export function getWindowInactive(): boolean {
  return inactive;
}

export function subscribeWindowInactive(listener: () => void): Unsubscribe {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: boolean, root: WindowActivitySources["root"]): void {
  if (next === inactive) return;
  inactive = next;
  if (next) root.setAttribute(WINDOW_INACTIVE_ATTR, "");
  else root.removeAttribute(WINDOW_INACTIVE_ATTR);
  for (const listener of [...listeners]) listener();
}

/**
 * Starts tracking and keeps `data-window-inactive` on `root` in sync.
 *
 * Starts as active: the window is assumed watched until a blur, a hidden
 * document or a native occlusion report says otherwise. Assuming "unfocused"
 * instead would leave every animation paused forever on a platform that never
 * delivers the first focus event.
 */
export function installWindowActivity(
  sources: WindowActivitySources,
): Unsubscribe {
  const { root, doc } = sources;
  let focused = true;
  let presentationVisible = true;

  const sync = () =>
    publish(
      isWindowInactive({
        focused,
        documentVisible: doc.visibilityState === "visible",
        presentationVisible,
      }),
      root,
    );

  const onVisibility = () => sync();
  doc.addEventListener("visibilitychange", onVisibility);
  const unbindFocus = sources.bindFocus((next) => {
    focused = next;
    sync();
  });
  const unsubscribePresentation = sources.subscribePresentation?.((state) => {
    presentationVisible = state.visible;
    sync();
  });
  sync();

  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    unbindFocus();
    unsubscribePresentation?.();
    publish(false, root);
  };
}

/** DOM-only focus source: enough for windows without a native feed. */
export function bindDomWindowFocus(
  listener: (focused: boolean) => void,
): Unsubscribe {
  if (typeof window === "undefined") return () => {};
  const onFocus = () => listener(true);
  const onBlur = () => listener(false);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
  };
}
