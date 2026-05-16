import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  PreviewAddressBar,
  type PreviewAddressBarHandle,
} from "./PreviewAddressBar";

export type PreviewPaneHandle = {
  reload: () => void;
  focusAddressBar: () => void;
  getUrl: () => string;
};

type Props = {
  tabId: number;
  url: string;
  visible: boolean;
  onUrlChange: (url: string) => void;
};

// Tear the iframe down after this much invisibility — a background dev
// server page can hold hundreds of MB inside the WebView.
const SUSPEND_AFTER_MS = 30_000;

export const PreviewPane = forwardRef<PreviewPaneHandle, Props>(
  function PreviewPane({ tabId, url, visible, onUrlChange }, ref) {
    const [nonce, setNonce] = useState(0);
    const [loaded, setLoaded] = useState(visible);
    const addressRef = useRef<PreviewAddressBarHandle>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // Tracks the URL the native webview is actually showing so we can avoid
    // a navigate -> onUrlChange -> url-prop-update -> navigate loop.
    const nativeUrlRef = useRef<string | null>(null);

    const isExternal = url ? !isLocalUrl(url) : false;

    // -- iframe suspension (localhost only) ---
    useEffect(() => {
      if (isExternal) return;
      if (visible) {
        setLoaded(true);
        return;
      }
      const t = setTimeout(() => setLoaded(false), SUSPEND_AFTER_MS);
      return () => clearTimeout(t);
    }, [visible, isExternal]);

    // -- imperative handle ---
    useImperativeHandle(
      ref,
      () => ({
        reload: () => {
          if (isExternal) {
            invoke("preview_reload", { tabId }).catch(console.error);
          } else {
            setLoaded(true);
            setNonce((n) => n + 1);
          }
        },
        focusAddressBar: () => addressRef.current?.focus(),
        getUrl: () => nativeUrlRef.current ?? url,
      }),
      [url, isExternal, tabId],
    );

    // -- native webview: open / navigate when URL changes ---
    useEffect(() => {
      if (!isExternal || !url) return;

      // Skip if the webview already navigated here (prevents loop with
      // the preview:url-changed listener below).
      if (url === nativeUrlRef.current) return;

      const el = contentRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();

      invoke("preview_open", {
        tabId,
        url,
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
        visible,
      })
        .then(() => {
          nativeUrlRef.current = url;
        })
        .catch(console.error);
    }, [url, isExternal, tabId, visible]);

    // -- native webview: close when URL switches back to localhost ---
    useEffect(() => {
      if (!isExternal) {
        invoke("preview_close", { tabId }).catch(console.error);
        nativeUrlRef.current = null;
      }
    }, [isExternal, tabId]);

    // -- native webview: sync visibility on tab switch ---
    useEffect(() => {
      if (!isExternal) return;
      invoke("preview_set_visible", { tabId, visible }).catch(console.error);

      if (visible) {
        // Re-sync bounds in case the layout changed while the tab was hidden.
        const el = contentRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          invoke("preview_set_bounds", {
            tabId,
            x: rect.left,
            y: rect.top,
            w: rect.width,
            h: rect.height,
          }).catch(console.error);
        }
      }
    }, [visible, isExternal, tabId]);

    // -- native webview: track size/position changes ---
    useEffect(() => {
      if (!isExternal) return;
      const el = contentRef.current;
      if (!el) return;

      const updateBounds = () => {
        const rect = el.getBoundingClientRect();
        invoke("preview_set_bounds", {
          tabId,
          x: rect.left,
          y: rect.top,
          w: rect.width,
          h: rect.height,
        }).catch(console.error);
      };

      const ro = new ResizeObserver(updateBounds);
      ro.observe(el);
      window.addEventListener("resize", updateBounds);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", updateBounds);
      };
    }, [isExternal, tabId]);

    // -- native webview: listen for navigation events (OAuth redirects, etc.)
    useEffect(() => {
      if (!isExternal) return;

      let cancelled = false;
      let unlisten: (() => void) | null = null;

      listen<{ tabId: number; url: string }>("preview:url-changed", (event) => {
        if (event.payload.tabId !== tabId) return;
        nativeUrlRef.current = event.payload.url;
        if (!cancelled) onUrlChange(event.payload.url);
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

      return () => {
        cancelled = true;
        unlisten?.();
      };
    }, [isExternal, tabId, onUrlChange]);

    // -- cleanup on tab close ---
    useEffect(() => {
      return () => {
        invoke("preview_close", { tabId }).catch(console.error);
      };
    }, [tabId]);

    return (
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background"
        style={{
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
        }}
      >
        <PreviewAddressBar
          ref={addressRef}
          url={url}
          onSubmit={onUrlChange}
          onReload={() => {
            if (isExternal) {
              invoke("preview_reload", { tabId }).catch(console.error);
            } else {
              setNonce((n) => n + 1);
            }
          }}
        />
        {/* This div is a layout placeholder. For external URLs a native
            child webview is layered on top at the OS level, bypassing
            X-Frame-Options / CSP entirely. */}
        <div
          ref={contentRef}
          className={
            url && !isExternal
              ? "relative min-h-0 flex-1 bg-white"
              : "relative min-h-0 flex-1 bg-background"
          }
        >
          {isExternal ? (
            url ? (
              <ExternalLoadingState />
            ) : (
              <EmptyState />
            )
          ) : url ? (
            loaded ? (
              <iframe
                key={`${url}#${nonce}`}
                src={url}
                title="Preview"
                className="h-full w-full border-0"
                allow="clipboard-read; clipboard-write; fullscreen"
              />
            ) : (
              <SuspendedState
                onReload={() => {
                  setLoaded(true);
                  setNonce((n) => n + 1);
                }}
              />
            )
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    );
  },
);

// Shown behind the native webview while it loads its first frame.
function ExternalLoadingState() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex size-10 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={18} strokeWidth={1.5} />
      </div>
    </div>
  );
}

function SuspendedState({ onReload }: { onReload: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={18} strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-[12.5px] font-medium text-foreground">
          Preview suspended
        </p>
        <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
          Released to free memory after sitting in the background.
        </p>
      </div>
      <button
        type="button"
        onClick={onReload}
        className="rounded-md border border-border/60 bg-card px-3 py-1 text-[11px] hover:bg-accent/50"
      >
        Reload
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={20} strokeWidth={1.5} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">
          Nothing to preview yet
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Type a URL above, or open the{" "}
          <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">
            Ports
          </span>{" "}
          dropdown to jump straight to your running dev server.
        </p>
      </div>
    </div>
  );
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
