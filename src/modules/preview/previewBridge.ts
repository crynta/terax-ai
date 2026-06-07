import { invoke } from "@tauri-apps/api/core";

/**
 * Thin typed wrapper over the Rust `preview_*` commands that drive a native
 * child webview (see src-tauri/src/modules/preview.rs). The webview renders the
 * URL as a top-level navigation, so framing rules (X-Frame-Options /
 * frame-ancestors) never apply — unlike the old `<iframe>` approach.
 */

export type PreviewBounds = {
  /** Logical px, relative to the window content top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Event emitted by Rust on every preview navigation (initial, redirect, SPA). */
export const PREVIEW_NAV_EVENT = "preview://navigated";

export type PreviewNavPayload = { label: string; url: string };

/** Stable per-tab webview label. */
export function previewLabel(id: number): string {
  return `preview-${id}`;
}

export const previewBridge = {
  open: (label: string, url: string, b: PreviewBounds): Promise<void> =>
    invoke("preview_open", {
      label,
      url,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    }),
  setBounds: (label: string, b: PreviewBounds): Promise<void> =>
    invoke("preview_set_bounds", {
      label,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    }),
  navigate: (label: string, url: string): Promise<void> =>
    invoke("preview_navigate", { label, url }),
  show: (label: string): Promise<void> => invoke("preview_show", { label }),
  hide: (label: string): Promise<void> => invoke("preview_hide", { label }),
  reload: (label: string): Promise<void> => invoke("preview_reload", { label }),
  close: (label: string): Promise<void> => invoke("preview_close", { label }),
};
