import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

type PreviewKeyPayload = {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/**
 * A focused native preview webview swallows the keyboard, so the host window's
 * global shortcuts (Ctrl+Tab, ...) never fire while the preview has focus. The
 * preview forwards an allow-list of app-shell keystrokes via the
 * `preview://shortcut-key` event (see src-tauri/src/modules/preview.rs); we
 * replay them as a synthetic keydown on the host window so `useGlobalShortcuts`
 * handles them exactly like a real press — reusing the live keymap and any user
 * rebindings, with no duplicated shortcut table.
 */
export function usePreviewShortcuts(): void {
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void listen<PreviewKeyPayload>("preview://shortcut-key", (e) => {
      const p = e.payload;
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: p.key,
          code: p.code,
          ctrlKey: p.ctrlKey,
          metaKey: p.metaKey,
          shiftKey: p.shiftKey,
          altKey: p.altKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    }).then((un) => {
      if (alive) unlisten = un;
      else un();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
}
