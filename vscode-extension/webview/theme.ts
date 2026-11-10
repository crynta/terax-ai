import { applyTheme, clearTheme } from "@/modules/theme/applyTheme";
import { tokyoNightSession } from "@/modules/theme/themes/tokyo-night-session";
import type { ReaderAccent, ReaderTheme } from "../src/protocol";
import "./vscode-theme.css";

let kindObserver: MutationObserver | null = null;

/** VS Code marks the webview body with its theme kind; light kinds drop `.dark`. */
function syncKind(): void {
  const body = document.body.classList;
  const light =
    body.contains("vscode-light") || body.contains("vscode-high-contrast-light");
  document.documentElement.classList.toggle("dark", !light);
}

/**
 * VS Code puts its own default webview styles (body padding, link and code
 * colours) in an unlayered `<style id="_defaultStyles">`, which outranks every
 * Tailwind layer. The Reader styles everything itself, so drop them.
 */
function dropDefaultStyles(): void {
  const remove = () => document.getElementById("_defaultStyles")?.remove();
  remove();
  new MutationObserver(remove).observe(document.head, { childList: true });
}

export function applyReaderTheme(theme: ReaderTheme, accent: ReaderAccent = "neutral"): void {
  const root = document.documentElement;
  root.dataset.readerTheme = theme;
  root.dataset.readerAccent = accent;
  kindObserver?.disconnect();
  kindObserver = null;
  if (theme === "tokyo-night") {
    applyTheme(tokyoNightSession, "dark");
    root.classList.add("dark");
    return;
  }
  clearTheme();
  syncKind();
  kindObserver = new MutationObserver(syncKind);
  kindObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
}

dropDefaultStyles();
