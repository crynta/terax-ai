import "@xterm/xterm/css/xterm.css";
import "./styles/globals.css";

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LazyStore } from "@tauri-apps/plugin-store";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { initLaunchDir } from "./lib/launchDir";
import { IS_LINUX, USE_CUSTOM_WINDOW_CONTROLS } from "./lib/platform";

type WindowSize = {
  width: number;
  height: number;
};

const MAIN_WINDOW_SIZE_STORE = "main-window-size.json";
const MAIN_WINDOW_MIN_WIDTH = 420;
const MAIN_WINDOW_MIN_HEIGHT = 280;
const MAIN_WINDOW_SAVE_DELAY_MS = 200;
const MAIN_WINDOW_RESIZE_READY_MS = 1000;

const mainWindowSizeStore = new LazyStore(MAIN_WINDOW_SIZE_STORE, {
  defaults: {},
  autoSave: false,
});

if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

// Render-instrumentation overlay, opt-in: `VITE_REACT_SCAN=true pnpm dev`.
// Dev-only dynamic import so it never reaches the production bundle.
if (import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN === "true") {
  const { scan } = await import("react-scan");
  scan({ enabled: true });
}

// Reap PTY sessions orphaned by a prior webview load before any tab spawns.
await invoke("pty_close_all").catch(() => {});

// Seed before first paint so default tab mounts at target cwd (no flicker).
await initLaunchDir();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);

function isUsableWindowSize(size: WindowSize): boolean {
  return (
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width >= MAIN_WINDOW_MIN_WIDTH &&
    size.height >= MAIN_WINDOW_MIN_HEIGHT
  );
}

function currentWindowSize(): WindowSize {
  return {
    width: Math.round(window.innerWidth),
    height: Math.round(window.innerHeight),
  };
}

async function saveLinuxMainWindowSize(
  appWindow: ReturnType<typeof getCurrentWindow>,
): Promise<void> {
  const size = currentWindowSize();
  if (!isUsableWindowSize(size)) return;

  const [maximized, fullscreen] = await Promise.all([
    appWindow.isMaximized(),
    appWindow.isFullscreen(),
  ]);
  if (maximized || fullscreen) return;

  await mainWindowSizeStore.set("width", size.width);
  await mainWindowSizeStore.set("height", size.height);
  await mainWindowSizeStore.save();
}

function startLinuxMainWindowSizePersistence(
  appWindow: ReturnType<typeof getCurrentWindow>,
): void {
  let ready = false;
  let saveTimer: number | undefined;

  const scheduleSave = () => {
    if (!ready) return;
    if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      void saveLinuxMainWindowSize(appWindow).catch((e) =>
        console.error("window size save failed:", e),
      );
    }, MAIN_WINDOW_SAVE_DELAY_MS);
  };

  window.setTimeout(() => {
    ready = true;
    scheduleSave();
  }, MAIN_WINDOW_RESIZE_READY_MS);

  void appWindow
    .onResized(() => scheduleSave())
    .catch((e) => console.error("window resize listener failed:", e));
}

let linuxSizePersistenceStarted = false;

// Window starts hidden (per tauri.conf.json) so users never see a transparent
// shadow-only frame before React paints. Use setTimeout — rAF is throttled
// while the window is hidden and would never fire.
const showWindow = () => {
  const appWindow = getCurrentWindow();
  appWindow
    .show()
    .then(() => {
      if (IS_LINUX && !linuxSizePersistenceStarted) {
        linuxSizePersistenceStarted = true;
        startLinuxMainWindowSizePersistence(appWindow);
      }
    })
    .catch((e) => console.error("window.show failed:", e));
};
setTimeout(showWindow, 50);
// Safety net: if the first show somehow fails to take effect, force again.
setTimeout(showWindow, 500);
