/**
 * Chromium and WebKit refuse to focus an element inside a `visibility:hidden`
 * subtree, and a pane that was just shown stays in one until its layers have
 * committed (a WebView2 window that is still activating can take hundreds of
 * milliseconds). The refused focus is silent and the first keystrokes then
 * land on the body, so focus is retried a few times, only while nothing else
 * has taken it, the first attempt included (the caller may reach this after a
 * lazy import, by which time the user can be elsewhere).
 */
const FOCUS_RETRY_DELAYS_MS: readonly number[] = [16, 48, 120, 300];

/** Focuses now and retries until it sticks; returns the cancellation. */
export function focusUntilActive(
  target: Element,
  focus: () => void,
  canFocus: () => boolean,
  delays: readonly number[] = FOCUS_RETRY_DELAYS_MS,
): () => void {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = (): void => {
    if (!canFocus()) return;
    const holder = document.activeElement;
    if (holder === target || (holder !== null && holder !== document.body))
      return;
    focus();
    if (document.activeElement === target || attempt >= delays.length) return;
    timer = setTimeout(() => {
      attempt += 1;
      run();
    }, delays[attempt]);
  };
  run();
  return () => clearTimeout(timer);
}
