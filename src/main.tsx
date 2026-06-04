import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/jetbrains-mono/cyrillic-400.css";
import "@fontsource/jetbrains-mono/cyrillic-700.css";
import "@xterm/xterm/css/xterm.css";
import "./styles/globals.css";

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { initLaunchDir } from "./lib/launchDir";
import { USE_CUSTOM_WINDOW_CONTROLS } from "./lib/platform";
import { startMainWindow } from "./mainBoot";

if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

void startMainWindow({
  app: <App />,
  closeAllPtys: () => invoke("pty_close_all"),
  createRoot: ReactDOM.createRoot,
  currentWindow: getCurrentWindow(),
  initLaunchDir,
  root: document.getElementById("root"),
});
