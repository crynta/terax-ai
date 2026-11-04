export type FocusEnv = {
  readonly isFocused: () => boolean;
  /** Nothing else holds focus, so a late retry cannot take it from the user. */
  readonly isUnclaimed: () => boolean;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

/**
 * Chromium and WebKit refuse to focus an element inside a `visibility:hidden`
 * subtree, and a pane that was just shown stays in one until its layers have
 * committed (a WebView2 window that is still activating can take hundreds of
 * milliseconds). The refused focus is silent and the first keystrokes then
 * land on the body, so focus is retried a few times, only while nothing else
 * has taken it.
 */
export const FOCUS_RETRY_DELAYS_MS: readonly number[] = [16, 48, 120, 300];

/** Focuses now and retries until it sticks; returns the cancellation. */
export function focusUntilActive(
  focus: () => void,
  env: FocusEnv,
  delays: readonly number[] = FOCUS_RETRY_DELAYS_MS,
): () => void {
  let cancelled = false;
  let attempt = 0;
  let handle: unknown;
  const schedule = (): void => {
    if (env.isFocused() || attempt >= delays.length) return;
    handle = env.setTimeout(() => {
      if (cancelled || env.isFocused() || !env.isUnclaimed()) return;
      attempt += 1;
      focus();
      schedule();
    }, delays[attempt]);
  };
  focus();
  schedule();
  return () => {
    cancelled = true;
    env.clearTimeout(handle);
  };
}

export function documentFocusEnv(input: Element): FocusEnv {
  return {
    isFocused: () => document.activeElement === input,
    isUnclaimed: () => {
      const active = document.activeElement;
      return active === null || active === document.body;
    },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as number),
  };
}
