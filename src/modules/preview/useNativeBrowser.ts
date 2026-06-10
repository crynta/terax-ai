import { useCallback, useEffect, useRef } from "react";

type BrowserEvent = {
  label: string;
  url: string;
};

type BrowserTitleEvent = {
  label: string;
  title: string;
};

/** True when running inside a Tauri webview (not in a unit test or SSR). */
const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke(cmd: string, args: Record<string, unknown>) {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke(cmd, args);
}

async function listen<T>(
  event: string,
  cb: (e: { payload: T }) => void,
) {
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  return tauriListen<T>(event, cb);
}

/**
 * Manages a native child webview positioned over a DOM container.
 *
 * - Creates/destroys a Tauri child webview for public URLs that can't be
 *   embedded in an iframe (X-Frame-Options / frame-ancestors CSP).
 * - Tracks the container's position via ResizeObserver and keeps the native
 *   overlay in sync.
 * - Forwards navigation events back to the React address bar.
 *
 * Returns helpers for the address bar to drive navigation/reload.
 */
export function useNativeBrowser(opts: {
  /** Unique label for this browser instance (used as the Tauri webview label). */
  label: string;
  /** The URL to load. When empty or local, no native webview is created. */
  url: string;
  /** Whether the preview tab containing this browser is currently visible. */
  visible: boolean;
  /** Called when the native webview navigates (user clicks a link, JS redirect). */
  onNavigate?: (url: string) => void;
  /** Called when the page title changes. */
  onTitleChange?: (title: string) => void;
}) {
  const { label, url, visible, onNavigate, onTitleChange } = opts;

  // Ref to the container div — we measure its bounds to position the child.
  const containerRef = useRef<HTMLDivElement>(null);

  // Whether the native webview currently exists.
  const aliveRef = useRef(false);

  // Latest URL for the resize observer callback (avoids stale closures).
  const urlRef = useRef(url);
  urlRef.current = url;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const syncBounds = useCallback(async () => {
    if (!aliveRef.current || !inTauri) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    try {
      await invoke("browser_set_bounds", {
        label,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    } catch {
      // Webview may have been closed already.
    }
  }, [label]);

  // Create or destroy the native webview when the URL changes.
  useEffect(() => {
    if (!inTauri || !url) return;
    // Only use native webview for public URLs.
    if (isLocalUrl(url)) return;

    const create = async () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      try {
        await invoke("browser_create", {
          label,
          url,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
        aliveRef.current = true;
        if (!visibleRef.current) {
          await invoke("browser_hide", { label }).catch(() => {});
        }
      } catch (e) {
        console.error("failed to create native browser:", e);
      }
    };

    void create();

    return () => {
      aliveRef.current = false;
      invoke("browser_close", { label }).catch(() => {});
    };
  }, [url, label]);

  // Navigate (URL changed without unmount — e.g. user types in address bar).
  useEffect(() => {
    if (!inTauri || !url || !aliveRef.current || isLocalUrl(url)) return;
    invoke("browser_navigate", { label, url }).catch(() => {});
  }, [url, label]);

  // Show/hide on tab visibility changes.
  useEffect(() => {
    if (!inTauri || !aliveRef.current) return;
    if (visible) {
      invoke("browser_show", { label })
        .then(() => syncBounds())
        .catch(() => {});
    } else {
      invoke("browser_hide", { label }).catch(() => {});
    }
  }, [visible, label, syncBounds]);

  // Keep the native overlay positioned over the container on resize.
  useEffect(() => {
    if (!inTauri) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      void syncBounds();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncBounds]);

  // Listen for navigation events emitted by the Rust side.
  useEffect(() => {
    if (!inTauri || (!onNavigate && !onTitleChange)) return;

    const unlisteners: Array<() => void> = [];

    (async () => {
      if (onNavigate) {
        const cb = (e: { payload: BrowserEvent }) => {
          if (e.payload.label === label) onNavigate(e.payload.url);
        };
        const un = await listen<BrowserEvent>("browser:navigation", cb);
        unlisteners.push(un);
      }
      if (onTitleChange) {
        const cb = (e: { payload: BrowserTitleEvent }) => {
          if (e.payload.label === label) onTitleChange(e.payload.title);
        };
        const un = await listen<BrowserTitleEvent>("browser:title", cb);
        unlisteners.push(un);
      }
    })();

    return () => {
      for (const un of unlisteners) un();
    };
  }, [label, onNavigate, onTitleChange]);

  return {
    /** Attach this ref to the container div that the native webview should overlay. */
    containerRef,
    /** Reload the current page. */
    reload: useCallback(async () => {
      if (aliveRef.current && inTauri) {
        try {
          await invoke("browser_reload", { label });
        } catch {
          // ignore
        }
      }
    }, [label]),
  };
}

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "0.0.0.0" ||
      h === "[::1]" ||
      h.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
