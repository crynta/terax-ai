import { cn } from "@/lib/utils";
import {
  listenFsChanged,
  parentDir,
  watchAdd,
  watchRemove,
} from "@/modules/explorer/lib/watch";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { WorkspaceEnv } from "@/modules/workspace";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import {
  createCoalescer,
  htmlPreviewAssetUrl,
  htmlPreviewSrc,
  htmlPreviewSupported,
  pathsInclude,
} from "./lib/htmlPreview";
import { MarkdownViewToggle } from "./MarkdownViewToggle";

type Props = {
  path: string;
  visible: boolean;
  /** The tab's own workspace, which may differ from the active one. */
  env: WorkspaceEnv;
  onSetView: (mode: "rendered" | "raw") => void;
};

// A rendered page can hold tens of MB inside the WebView; release it after
// sitting in the background, same policy as the dev-server preview.
const SUSPEND_AFTER_MS = 30_000;

// A Terax write emits fs:file-written at once and the watcher's fs:changed
// trails it by FSEvents latency (100 ms) plus its debounce (150 ms).
const RELOAD_COALESCE_MS = 300;

export function HtmlPreviewPane({ path, visible, env, onSetView }: Props) {
  const supported = htmlPreviewSupported(env);
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
    if (!htmlPreviewSupported(env)) return;
    const dir = parentDir(path);
    watchAdd([dir], [path], env);

    const reload = createCoalescer(() => {
      if (visibleRef.current) setRevision((r) => r + 1);
      else staleRef.current = true;
    }, RELOAD_COALESCE_MS);
    const onChange = (paths: readonly string[]) => {
      if (pathsInclude(paths, path)) reload.trigger();
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
      reload.cancel();
      for (const un of unlisteners) un();
      watchRemove([dir], [path], env);
    };
  }, [path, env]);

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
        onReload={
          supported
            ? () => {
                setLoaded(true);
                setRevision((r) => r + 1);
              }
            : undefined
        }
      />
      {supported ? (
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
      ) : (
        <p className="px-8 py-6 text-[12px] text-muted-foreground">
          HTML preview is not available in WSL workspaces yet.
        </p>
      )}
    </div>
  );
}
