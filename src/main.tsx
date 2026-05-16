import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/jetbrains-mono/cyrillic-400.css";
import "@fontsource/jetbrains-mono/cyrillic-700.css";
import "@xterm/xterm/css/xterm.css";
import "./styles/globals.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { USE_CUSTOM_WINDOW_CONTROLS } from "./lib/platform";

// We check for __TAURI_INTERNALS__ to ensure we're not running in a standard browser.
const isTauri = !!(window as any).__TAURI_INTERNALS__;

function TauriError() {
  return (
    <div className="flex h-screen flex-col items-center justify-center p-5 text-center font-sans">
      <h1 className="mb-3 text-2xl font-semibold">Tauri IPC Not Found</h1>
      <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
        Terax must be ran as a desktop application. Standard browsers are not
        supported because they lack access to the native PTY and file system.
      </p>
      <code className="mt-6 rounded-md bg-muted px-3 py-2 font-mono text-sm">
        pnpm dev
      </code>
    </div>
  );
}

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);

if (!isTauri) {
  root.render(<TauriError />);
} else {
  if (USE_CUSTOM_WINDOW_CONTROLS) {
    document.documentElement.dataset.chrome = "borderless";
  }

  root.render(<App />);
}
// Window starts hidden (per tauri.conf.json) so users never see a transparent
// shadow-only frame before React paints. Use setTimeout — rAF is throttled
// while the window is hidden and would never fire.
const showWindow = () => {
  getCurrentWindow()
    .show()
    .catch((e) => console.error("window.show failed:", e));
};
setTimeout(showWindow, 50);
// Safety net: if the first show somehow fails to take effect, force again.
setTimeout(showWindow, 500);
