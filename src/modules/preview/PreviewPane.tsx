import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  PreviewAddressBar,
  type PreviewAddressBarHandle,
} from "./PreviewAddressBar";
import {
  PREVIEW_NAV_EVENT,
  type PreviewBounds,
  type PreviewNavPayload,
  previewBridge,
  previewLabel,
} from "./previewBridge";

export type PreviewPaneHandle = {
  reload: () => void;
  focusAddressBar: () => void;
  getUrl: () => string;
};

type Props = {
  id: number;
  url: string;
  visible: boolean;
  /** A modal/dropdown that overlaps the pane is open; the native webview
   *  renders above all HTML, so it must be hidden to not cover the overlay. */
  suppressed: boolean;
  onUrlChange: (url: string) => void;
};

/**
 * Hosts a native Tauri child webview (created/driven from Rust) over the pane's
 * content area. The webview is a separate native layer positioned to match
 * `hostRef`; it renders above the HTML, so it is shown only when this preview
 * is the active tab and nothing overlaps it.
 */
export const PreviewPane = forwardRef<PreviewPaneHandle, Props>(
  function PreviewPane({ id, url, visible, suppressed, onUrlChange }, ref) {
    const label = previewLabel(id);
    const hostRef = useRef<HTMLDivElement>(null);
    const addressRef = useRef<PreviewAddressBarHandle>(null);
    const [portsOpen, setPortsOpen] = useState(false);

    // getUrl()/nav handler need the latest values without re-creating effects.
    const urlRef = useRef(url);
    urlRef.current = url;
    const onUrlChangeRef = useRef(onUrlChange);
    onUrlChangeRef.current = onUrlChange;

    const createdRef = useRef(false);
    const shownRef = useRef(false);
    // URL the webview is currently at (updated by nav events). Used to avoid
    // re-navigating in response to a URL change that the webview itself caused.
    const lastUrlRef = useRef(url);

    const measure = useCallback((): PreviewBounds | null => {
      const el = hostRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }, []);

    const sync = useCallback(async () => {
      const wantShow = visible && !suppressed && !portsOpen && !!url;

      if (!wantShow) {
        if (createdRef.current && shownRef.current) {
          shownRef.current = false;
          await previewBridge.hide(label);
        }
        return;
      }

      const bounds = measure();
      if (!bounds) return; // not laid out yet; ResizeObserver re-runs this

      if (!createdRef.current) {
        createdRef.current = true;
        shownRef.current = true;
        lastUrlRef.current = url;
        await previewBridge.open(label, url, bounds);
        return;
      }

      if (url !== lastUrlRef.current) {
        lastUrlRef.current = url;
        await previewBridge.navigate(label, url);
      }
      shownRef.current = true;
      // open() on an existing webview just repositions + shows it.
      await previewBridge.open(label, url, bounds);
    }, [visible, suppressed, portsOpen, url, label, measure]);

    // rAF-coalesce the burst of ResizeObserver/resize callbacks during drags.
    const rafRef = useRef(0);
    const scheduleSync = useCallback(() => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        void sync();
      });
    }, [sync]);

    // Re-runs whenever any input to `sync` changes (visibility, url, ...).
    useEffect(() => {
      void sync();
    }, [sync]);

    // Track the host element's box (sidebar/pane resize, window resize, zen).
    useEffect(() => {
      const el = hostRef.current;
      if (!el) return;
      const ro = new ResizeObserver(scheduleSync);
      ro.observe(el);
      window.addEventListener("resize", scheduleSync);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", scheduleSync);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }, [scheduleSync]);

    // Keep the address bar in sync with the webview's real URL (initial load,
    // auth redirects, in-page navigation).
    useEffect(() => {
      let alive = true;
      let unlisten: UnlistenFn | undefined;
      void listen<PreviewNavPayload>(PREVIEW_NAV_EVENT, (e) => {
        if (e.payload.label !== label) return;
        lastUrlRef.current = e.payload.url;
        onUrlChangeRef.current(e.payload.url);
      }).then((un) => {
        if (alive) unlisten = un;
        else un();
      });
      return () => {
        alive = false;
        unlisten?.();
      };
    }, [label]);

    // Destroy the webview when the preview tab is closed.
    useEffect(() => {
      return () => {
        void previewBridge.close(label);
        createdRef.current = false;
        shownRef.current = false;
      };
    }, [label]);

    useImperativeHandle(
      ref,
      () => ({
        reload: () => void previewBridge.reload(label),
        focusAddressBar: () => addressRef.current?.focus(),
        getUrl: () => urlRef.current,
      }),
      [label],
    );

    return (
      <div className="flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background">
        <PreviewAddressBar
          ref={addressRef}
          url={url}
          onSubmit={onUrlChange}
          onReload={() => void previewBridge.reload(label)}
          onMenuOpenChange={setPortsOpen}
        />
        <div ref={hostRef} className="relative min-h-0 flex-1 bg-background">
          {url ? null : <EmptyState />}
        </div>
      </div>
    );
  },
);

function EmptyState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <HugeiconsIcon icon={Globe02Icon} size={28} strokeWidth={1.5} />
      <p className="text-[12px]">Enter a URL or pick a dev-server port.</p>
    </div>
  );
}
