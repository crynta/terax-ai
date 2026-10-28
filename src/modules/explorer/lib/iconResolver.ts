// Startup-safe face of the file-icon system. The ~360 kB icon set lives in
// `iconEngine.ts` and is fetched on first demand, so a window that never draws
// a file icon (terminal-only, explorer closed) pays nothing for it. Until the
// engine arrives every lookup returns "" and callers render a same-size blank
// slot; once it has loaded, lookups are synchronous and subscribers re-render.
import type { IconEngine } from "./iconEngine";

let engine: IconEngine | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Starts (once) loading the icon set. Resolves when icons are synchronous. */
export function preloadFileIcons(): Promise<void> {
  if (engine) return Promise.resolve();
  loading ??= import("./iconEngine").then(
    (mod) => {
      engine = mod.iconEngine;
      loading = null;
      for (const listener of [...listeners]) listener();
    },
    (error: unknown) => {
      // Allow a retry on the next demand instead of caching the failure.
      loading = null;
      console.warn("[terax] file icons failed to load:", error);
    },
  );
  return loading;
}

/**
 * `useSyncExternalStore` subscription. Subscribing is what asks for the icon
 * set (in the commit phase, never during render); once it is loaded there is
 * nothing left to notify about, so late subscribers cost no listener slot.
 */
export function subscribeFileIcons(listener: () => void): () => void {
  if (engine) return noop;
  listeners.add(listener);
  void preloadFileIcons();
  return () => {
    listeners.delete(listener);
  };
}

function noop(): void {}

/** Pure read of the current icon URL: "" until the icon set has loaded. */
export function peekFileIconUrl(name: string): string {
  return engine ? engine.fileIconUrl(name) : "";
}

export function peekFolderIconUrl(name: string, expanded: boolean): string {
  return engine ? engine.folderIconUrl(name, expanded) : "";
}
