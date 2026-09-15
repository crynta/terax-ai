import { getCurrentWindow } from "@tauri-apps/api/window";

export const FOCUSED_TERMINAL_FRAME_INTERVAL_MS = 1_000 / 60;
export const BACKGROUND_TERMINAL_FRAME_INTERVAL_MS = 1_000 / 30;
export const UNFOCUSED_WINDOW_FRAME_INTERVAL_MS = 1_000 / 15;

export function terminalFrameIntervalMs(
  windowFocused: boolean,
  hasFocusedSurface: boolean,
): number {
  if (!windowFocused) return UNFOCUSED_WINDOW_FRAME_INTERVAL_MS;
  return hasFocusedSurface
    ? FOCUSED_TERMINAL_FRAME_INTERVAL_MS
    : BACKGROUND_TERMINAL_FRAME_INTERVAL_MS;
}

export function bindTerminalWindowFocus(
  listener: (focused: boolean) => void,
): () => void {
  let disposed = false;
  let unlistenTauri: (() => void) | undefined;
  const handleFocus = (): void => listener(true);
  const handleBlur = (): void => listener(false);

  if (typeof window !== "undefined") {
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    if ("__TAURI_INTERNALS__" in window) {
      getCurrentWindow()
        .onFocusChanged(({ payload }) => listener(payload))
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlistenTauri = unlisten;
        })
        .catch(() => {});
    }
  }

  return () => {
    disposed = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    }
    unlistenTauri?.();
  };
}

export function terminalWindowFocused(): boolean {
  return typeof document !== "undefined" &&
    typeof document.hasFocus === "function"
    ? document.hasFocus()
    : true;
}
