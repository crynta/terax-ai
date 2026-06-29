import { getCurrentWindow } from "@tauri-apps/api/window";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";

export function initWindowChrome() {
  if (!USE_CUSTOM_WINDOW_CONTROLS) return;

  document.documentElement.dataset.chrome = "borderless";

  const window = getCurrentWindow();
  const syncMaximized = () => {
    void window
      .isMaximized()
      .then((maximized) => {
        document.documentElement.dataset.windowMaximized = String(maximized);
      })
      .catch(() => {
        delete document.documentElement.dataset.windowMaximized;
      });
  };

  syncMaximized();
  void window.onResized(syncMaximized);
}
