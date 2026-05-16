import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

async function isWindowTouchingEdge(): Promise<boolean> {
  const w = getCurrentWindow();
  if (await w.isMaximized()) return true;
  const pos = await w.outerPosition();
  const size = await w.outerSize();
  const monitors = await availableMonitors();
  for (const mon of monitors) {
    const mx = mon.position.x;
    const my = mon.position.y;
    const mw = mon.size.width;
    const mh = mon.size.height;
    if (
      pos.x === mx ||
      pos.y === my ||
      pos.x + size.width === mx + mw ||
      pos.y + size.height === my + mh
    )
      return true;
  }
  return false;
}

export function useWindowSnapped(): void {
  useEffect(() => {
    const w = getCurrentWindow();
    let unlistenResize: (() => void) | undefined;

    const updateSnapped = async () => {
      try {
        document.documentElement.dataset.snapped =
          (await isWindowTouchingEdge()) ? "true" : "false";
      } catch {
        document.documentElement.dataset.snapped = "false";
      }
    };

    void updateSnapped();
    void w.onResized(() => void updateSnapped()).then((un) => {
      unlistenResize = un;
    });

    return () => {
      unlistenResize?.();
      delete document.documentElement.dataset.snapped;
    };
  }, []);
}
