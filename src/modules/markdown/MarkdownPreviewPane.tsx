import { cn } from "@/lib/utils";
import {
  listenFsChanged,
  watchAdd,
  watchRemove,
} from "@/modules/explorer/lib/watch";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { parentDir } from "./localImages";
import { MarkdownViewToggle } from "./MarkdownViewToggle";
import { RenderedMarkdown } from "./RenderedMarkdown";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type Status =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "binary" }
  | { kind: "toolarge"; size: number; limit: number }
  | { kind: "error"; message: string };

type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

/**
 * Loads the file and keeps it fresh: the fs watcher (dir-level, the backend
 * only watches directories, same as useEditorFileSync) triggers re-reads on
 * external change. Refresh reads never pass through "loading", so the pane
 * keeps the previous render (and scroll position) until new content lands;
 * only a failed read (e.g. file deleted) leaves the "ready" state.
 */
export function syncPreviewFile(
  path: string,
  setStatus: (status: Status) => void,
): () => void {
  let cancelled = false;
  let latest = 0;

  const read = () => {
    const seq = ++latest;
    invoke<ReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((res) => {
        if (cancelled || seq !== latest) return;
        if (res.kind === "text") {
          setStatus({ kind: "ready", content: res.content });
        } else if (res.kind === "binary") {
          setStatus({ kind: "binary" });
        } else {
          setStatus({ kind: "toolarge", size: res.size, limit: res.limit });
        }
      })
      .catch((e) => {
        if (cancelled || seq !== latest) return;
        setStatus({ kind: "error", message: String(e) });
      });
  };

  setStatus({ kind: "loading" });
  read();

  const dir = parentDir(path);
  watchAdd([dir]);
  const target = path.replace(/\\/g, "/");
  let unlisten: (() => void) | undefined;
  void listenFsChanged((paths) => {
    if (cancelled) return;
    if (paths.some((p) => p.replace(/\\/g, "/") === target)) read();
  }).then((un) => {
    if (cancelled) un();
    else unlisten = un;
  });

  return () => {
    cancelled = true;
    unlisten?.();
    watchRemove([dir]);
  };
}

export function MarkdownPreviewPane({ path, visible, onSetView }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => syncPreviewFile(path, setStatus), [path]);

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <MarkdownViewToggle mode="rendered" onChange={onSetView} />
      <div className="flex-1 overflow-auto">
        <article className="markdown-body mx-auto max-w-[980px] select-text px-8 py-6">
          {status.kind === "loading" && (
            <p className="text-[12px] text-muted-foreground">Loading…</p>
          )}
          {status.kind === "error" && (
            <p className="text-[12px] text-destructive">
              Failed to read file: {status.message}
            </p>
          )}
          {status.kind === "binary" && (
            <p className="text-[12px] text-muted-foreground">
              Binary file, cannot render as markdown.
            </p>
          )}
          {status.kind === "toolarge" && (
            <p className="text-[12px] text-muted-foreground">
              File is {status.size} bytes; limit {status.limit}.
            </p>
          )}
          {status.kind === "ready" && (
            <RenderedMarkdown
              content={status.content}
              baseDir={parentDir(path)}
            />
          )}
        </article>
      </div>
    </div>
  );
}
