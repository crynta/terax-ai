import { Alert02Icon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
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
  url: string;
  visible: boolean;
  onUrlChange: (url: string) => void;
};

export const PreviewPane = forwardRef<PreviewPaneHandle, Props>(
  function PreviewPane({ url, visible, onUrlChange }, ref) {
    // `nonce` is part of the iframe `key`. Bumping it remounts the iframe,
    // which is the only reliable cross-origin reload (calling
    // contentWindow.location.reload() throws on cross-origin frames).
    const [nonce, setNonce] = useState(0);
    const addressRef = useRef<PreviewAddressBarHandle>(null);

    useImperativeHandle(
      ref,
      () => ({
        reload: () => setNonce((n) => n + 1),
        focusAddressBar: () => addressRef.current?.focus(),
        getUrl: () => url,
      }),
      [url],
    );

    const showXfoHint = url ? !isLocalUrl(url) : false;

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
          onReload={() => setNonce((n) => n + 1)}
        />
        {showXfoHint ? (
          <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/60 bg-amber-500/8 px-3 text-[11px] text-amber-600 dark:text-amber-400">
            <HugeiconsIcon
              icon={Alert02Icon}
              size={12}
              strokeWidth={1.75}
              className="shrink-0"
            />
            <span className="truncate">
              Many public sites refuse to embed (X-Frame-Options). If the page
              is blank, open it externally.
            </span>
          </div>
        ) : null}
        <div
          className={
            url
              ? "relative min-h-0 flex-1 bg-white"
              : "relative min-h-0 flex-1 bg-background"
          }
        >
          {url ? (
            <iframe
              key={`${url}#${nonce}`}
              src={url}
              title="Preview"
              className="h-full w-full border-0"
              allow="clipboard-read; clipboard-write; fullscreen"
            />
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    );
  },
);

function EmptyState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={18} strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          Enter a URL to preview
        </p>
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          Local dev servers (vite, next, …) work best. Public sites usually
          refuse to embed — use the link button to open them externally.
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
