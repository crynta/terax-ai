import { cn } from "@/lib/utils";
import {
  listenFsChanged,
  parentDir,
  watchAdd,
  watchRemove,
} from "@/modules/explorer/lib/watch";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import {
  htmlPreviewAssetUrl,
  htmlPreviewSrc,
  pathsInclude,
} from "./lib/htmlPreview";
import { MarkdownViewToggle } from "./MarkdownViewToggle";

type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

// A rendered page can hold tens of MB inside the WebView; release it after
// sitting in the background, same policy as the dev-server preview.
const SUSPEND_AFTER_MS = 30_000;

export function HtmlPreviewPane({ path, visible, onSetView }: Props) {
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(visible);
  const visibleRef = useRef(visible);
  const staleRef = useRef(false);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) {
      setLoaded(true);
      if (staleRef.current) {
        staleRef.current = false;
        setRevision((r) => r + 1);
      }
      return;
    }
    const t = setTimeout(() => setLoaded(false), SUSPEND_AFTER_MS);
    return () => clearTimeout(t);
  }, [visible]);

  useEffect(() => {
    const dir = parentDir(path);
    watchAdd([dir], [path]);

    const onChange = (paths: readonly string[]) => {
      if (!pathsInclude(paths, path)) return;
      if (visibleRef.current) setRevision((r) => r + 1);
      else staleRef.current = true;
    };

    let alive = true;
    const unlisteners: Array<() => void> = [];
    const hold = (p: Promise<() => void>) => {
      void p.then((un) => (alive ? unlisteners.push(un) : un()));
    };
    hold(listenFsChanged(onChange));
    hold(
      getCurrentWebviewWindow().listen<{ path: string }>(
        "fs:file-written",
        (e) => onChange([e.payload.path]),
      ),
    );

    return () => {
      alive = false;
      for (const un of unlisteners) un();
      watchRemove([dir], [path]);
    };
  }, [path]);

  const src = htmlPreviewSrc(
    htmlPreviewAssetUrl(convertFileSrc(""), path),
    revision,
  );

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <MarkdownViewToggle
        mode="rendered"
        onChange={onSetView}
        onReload={() => {
          setLoaded(true);
          setRevision((r) => r + 1);
        }}
      />
      <div className="relative min-h-0 flex-1 bg-white">
        {loaded ? (
          <iframe
            key={src}
            src={src}
            title="HTML preview"
            className="h-full w-full border-0"
            // No allow-same-origin: the page gets an opaque origin, so the
            // asset protocol's CORS check stops its scripts from reading any
            // other local file. No allow-top-navigation: it can never replace
            // the Terax webview that holds the IPC bridge.
            sandbox="allow-scripts allow-forms allow-modals"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </div>
    </div>
  );
}
