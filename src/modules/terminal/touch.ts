// src/modules/terminal/touch.ts
//
// Adds soft-keyboard support to an xterm.js Terminal on Android.
// Uses a hidden <input> to pull up the IME, then forwards typed
// characters and special keys into the terminal.
//
// Usage:
//   import { installTouchInput } from "./touch";
//   // inside your terminal useEffect:
//   const cleanup = installTouchInput(term, containerRef.current!);
//   return () => cleanup();

import type { Terminal } from "@xterm/xterm";

/**
 * Install touch input support on a terminal container.
 * Returns a cleanup function — call it when the terminal unmounts.
 */
export function installTouchInput(
  terminal: Terminal,
  container: HTMLElement
): () => void {
  // Only activate on touch devices (Android, iOS)
  if (!navigator.maxTouchPoints || navigator.maxTouchPoints === 0) {
    return () => {};
  }

  // ── Hidden input that receives IME / keyboard input ──────────────────────
  const hidden = document.createElement("input");
  hidden.setAttribute("autocorrect", "off");
  hidden.setAttribute("autocapitalize", "none");
  hidden.setAttribute("autocomplete", "off");
  hidden.setAttribute("spellcheck", "false");
  hidden.setAttribute("inputmode", "text");
  hidden.setAttribute("tabindex", "-1");
  hidden.setAttribute("aria-hidden", "true");
  hidden.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:0",
    "width:1px",
    "height:1px",
    "opacity:0",
    "border:none",
    "outline:none",
    "padding:0",
    "margin:0",
    "background:transparent",
    "color:transparent",
    "caret-color:transparent",
  ].join(";");

  document.body.appendChild(hidden);

  // ── Tap the terminal → focus the hidden input → keyboard pops up ─────────
  const onContainerClick = () => {
    hidden.focus({ preventScroll: true });
  };
  container.addEventListener("click", onContainerClick);
  container.addEventListener("touchend", onContainerClick, { passive: true });

  // ── Forward regular typed text ─────────────────────────────────────────────
  const onInput = (e: Event) => {
    const inputEl = e.target as HTMLInputElement;
    const text = inputEl.value;
    if (text) {
      // terminal.paste() sends text as if it were typed — respects bracketed
      // paste mode if enabled.
      terminal.paste(text);
      inputEl.value = "";
    }
  };
  hidden.addEventListener("input", onInput);

  // ── Forward special keys ───────────────────────────────────────────────────
  const KEY_MAP: Record<string, string> = {
    Backspace:   "\x7f",
    Delete:      "\x1b[3~",
    Enter:       "\r",
    Tab:         "\t",
    Escape:      "\x1b",
    ArrowUp:     "\x1b[A",
    ArrowDown:   "\x1b[B",
    ArrowRight:  "\x1b[C",
    ArrowLeft:   "\x1b[D",
    Home:        "\x1b[H",
    End:         "\x1b[F",
    PageUp:      "\x1b[5~",
    PageDown:    "\x1b[6~",
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const seq = KEY_MAP[e.key];
    if (seq) {
      e.preventDefault();
      terminal.paste(seq);
      return;
    }
    // Ctrl+C, Ctrl+D, etc.
    if (e.ctrlKey && e.key.length === 1) {
      const code = e.key.toUpperCase().charCodeAt(0) - 64;
      if (code > 0 && code < 32) {
        e.preventDefault();
        terminal.paste(String.fromCharCode(code));
      }
    }
  };
  hidden.addEventListener("keydown", onKeyDown);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  return () => {
    container.removeEventListener("click", onContainerClick);
    container.removeEventListener("touchend", onContainerClick);
    hidden.removeEventListener("input", onInput);
    hidden.removeEventListener("keydown", onKeyDown);
    if (hidden.parentNode) {
      hidden.parentNode.removeChild(hidden);
    }
  };
}

