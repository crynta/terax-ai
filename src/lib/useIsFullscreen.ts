import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

/** Tracks the native fullscreen state of the current window. On macOS the
 *  traffic lights auto-hide in fullscreen, so chrome that reserves space for
 *  them (header left padding) should collapse while this is true. */
export function useIsFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    const sync = () => {
      void win
        .isFullscreen()
        .then((v) => {
          if (!disposed) setFullscreen(v);
        })
        .catch(() => {});
    };
    sync();
    // Fullscreen transitions always resize the window; there is no dedicated
    // fullscreen event in Tauri, so re-check on every resize.
    const unlisten = win.onResized(() => sync());
    return () => {
      disposed = true;
      void unlisten.then((un) => un());
    };
  }, []);

  return fullscreen;
}
