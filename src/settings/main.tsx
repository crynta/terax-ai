import "../styles/globals.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@/modules/theme";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { SettingsApp } from "./SettingsApp";

if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

ReactDOM.createRoot(
  document.getElementById("settings-root") as HTMLElement,
).render(
  <ThemeProvider>
    <SettingsApp />
  </ThemeProvider>,
);

// Pre-warmed instances (?prewarm) stay hidden — Rust shows the window when
// the user actually opens Settings; self-showing here would flash it over
// the app at startup.
if (!new URLSearchParams(window.location.search).has("prewarm")) {
  const showWindow = () => {
    getCurrentWindow()
      .show()
      .catch((e) => console.error("settings show failed:", e));
  };
  setTimeout(showWindow, 50);
  setTimeout(showWindow, 500);
}
