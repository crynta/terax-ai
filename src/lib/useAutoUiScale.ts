import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

export function autoUiScaleForWidth(logicalWidth: number): number {
  if (logicalWidth >= 2200) return 1.16;
  if (logicalWidth >= 1700) return 1.08;
  return 1;
}

export function useAutoUiScale(onScaleApplied?: () => void) {
  useEffect(() => {
    const webview = getCurrentWebview();
    const appWindow = getCurrentWindow();
    let disposed = false;
    let lastScale = 0;
    let applyTimer: ReturnType<typeof setTimeout> | null = null;

    const apply = () => {
      if (applyTimer) clearTimeout(applyTimer);
      applyTimer = setTimeout(() => {
        applyTimer = null;
        void Promise.all([appWindow.innerSize(), appWindow.scaleFactor()])
          .then(([size, scaleFactor]) => {
            if (disposed) return;
            const logicalWidth = size.width / scaleFactor;
            const nextScale = autoUiScaleForWidth(logicalWidth);
            if (Math.abs(nextScale - lastScale) < 0.01) return;
            lastScale = nextScale;
            return webview.setZoom(nextScale);
          })
          .then(() => {
            if (disposed) return;
            requestAnimationFrame(() => onScaleApplied?.());
          })
          .catch((err) => {
            console.warn("Failed to apply auto UI scale:", err);
          });
      }, 80);
    };

    apply();
    const unlistenResize = appWindow.onResized(apply);
    const unlistenScale = appWindow.onScaleChanged(apply);

    return () => {
      disposed = true;
      if (applyTimer) clearTimeout(applyTimer);
      void unlistenResize.then((unlisten) => unlisten());
      void unlistenScale.then((unlisten) => unlisten());
    };
  }, [onScaleApplied]);
}
