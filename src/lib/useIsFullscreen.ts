import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Tracks the current Tauri window's fullscreen state. Used to remove the
// macOS traffic-light gutter when the window goes fullscreen (the OS hides
// the traffic lights so the reserved left padding becomes wasted space).
export function useIsFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let alive = true;

    void win.isFullscreen().then((v) => {
      if (alive) setIsFullscreen(v);
    });

    const unlistenPromise = win.onResized(() => {
      void win.isFullscreen().then((v) => {
        if (alive) setIsFullscreen(v);
      });
    });

    return () => {
      alive = false;
      void unlistenPromise.then((un) => un());
    };
  }, []);

  return isFullscreen;
}
