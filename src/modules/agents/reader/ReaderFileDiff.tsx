/**
 * A file changed in this chat, opened for review in a dialog over the Reader:
 * Claude's changes inline, each with Keep / Undo, and the file editable in
 * place (see ReaderFileReview), so reviewing never leaves the session.
 */
import { openTerminalLink } from "@/modules/terminal/lib/terminalFileLinks";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  Cancel01Icon,
  File01Icon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { Dialog as DialogPrimitive } from "radix-ui";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { repoRelative } from "./lib/changes";
import { repoFor } from "./lib/contextClient";
import {
  reverseApplyEdits,
  sessionEdits,
  splitDisplayPath,
} from "./lib/fullFileDiff";
import type { ReaderDocument } from "./lib/transcript";
import { FileReview } from "./ReaderFileReview";

export type FileDiffApi = {
  /** Opens the dialog for `path` (absolute). */
  open: (path: string) => void;
  /** Whether `path` (absolute or relative to the session) was changed in this chat. */
  has: (path: string) => boolean;
  /** The absolute changed path `path` names, or null. */
  resolve: (path: string) => string | null;
};

const FileDiffContext = createContext<FileDiffApi | null>(null);

export const FileDiffProvider = FileDiffContext.Provider;

export function useFileDiff(): FileDiffApi | null {
  return useContext(FileDiffContext);
}

/** Builds the lookup for the changed files of a session. */
export function fileDiffLookup(
  paths: readonly string[],
  cwd: string | null,
): (path: string) => string | null {
  const set = new Set(paths);
  const base = cwd?.replace(/\/+$/, "") ?? null;
  return (raw: string) => {
    const path = raw.replace(/^file:\/\//, "").replace(/:\d+(?::\d+)?$/, "");
    if (set.has(path)) return path;
    if (base && !path.startsWith("/")) {
      const joined = `${base}/${path.replace(/^\.\//, "")}`;
      if (set.has(joined)) return joined;
    }
    return null;
  };
}

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type Versions = {
  head: string | null;
  working: string | null;
  binary: boolean;
};

type Load =
  | { kind: "loading" }
  | {
      kind: "ready";
      original: string;
      current: string;
      newFile: boolean;
      repoRoot: string | null;
    }
  | { kind: "message"; text: string; error?: boolean };

/**
 * The file now and the version its changes are reviewed against: `HEAD` in a
 * git repository, else the file before this chat's edits.
 */
async function loadVersions(
  path: string,
  cwd: string | null,
  doc: ReaderDocument,
): Promise<Load> {
  const repo = cwd ? await repoFor(cwd) : null;
  const rel = repo ? repoRelative(path, repo.repoRoot) : null;
  if (repo && rel) {
    const versions = await invoke<Versions>("git_file_versions", {
      repoRoot: repo.repoRoot,
      path: rel,
      workspace: currentWorkspaceEnv(),
    });
    if (versions.binary) {
      return {
        kind: "message",
        text: "This is a binary file, so there's no line diff to review.",
      };
    }
    if (versions.working === null) {
      return { kind: "message", text: "This file no longer exists." };
    }
    return {
      kind: "ready",
      original: versions.head ?? "",
      current: versions.working,
      newFile: versions.head === null,
      repoRoot: repo.repoRoot,
    };
  }
  const read = await invoke<ReadResult>("fs_read_file", {
    path,
    workspace: currentWorkspaceEnv(),
  });
  if (read.kind === "binary") {
    return {
      kind: "message",
      text: "This is a binary file, so there's no line diff to review.",
    };
  }
  if (read.kind === "toolarge") {
    return { kind: "message", text: "This file is too large to review here." };
  }
  return {
    kind: "ready",
    original: reverseApplyEdits(read.content, sessionEdits(doc, path, cwd)),
    current: read.content,
    newFile: false,
    repoRoot: null,
  };
}

export function FileDiffDialog({
  path,
  sessionId,
  cwd,
  home,
  doc,
  onClose,
}: {
  path: string | null;
  /** The chat the file was changed in (lets a host check it may save the file). */
  sessionId: string | null;
  cwd: string | null;
  home: string | null;
  doc: ReaderDocument;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoad({ kind: "loading" });
    void loadVersions(path, cwd, docRef.current)
      .then((result) => live && setLoad(result))
      .catch(
        (error: unknown) =>
          live &&
          setLoad({ kind: "message", text: String(error), error: true }),
      );
    return () => {
      live = false;
    };
  }, [path, cwd]);

  const shownPath = path ? splitDisplayPath(path, cwd, home) : null;

  return (
    <DialogPrimitive.Root
      open={path !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[1000] bg-black/55 data-open:animate-in data-open:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          // Keep keys inside the dialog: the Reader behind it has its own shortcuts.
          onKeyDown={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            // The Reader puts focus back in its composer itself.
            event.preventDefault();
          }}
          aria-describedby={undefined}
          // Fade only: a scale-in would leave the editor measuring a scaled box.
          className="terax-reader fixed top-1/2 left-1/2 z-[1001] flex h-[min(88vh,960px)] w-[min(1180px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background text-foreground shadow-2xl outline-none data-open:animate-in data-open:fade-in-0 motion-reduce:animate-none"
        >
          <div className="flex min-w-0 shrink-0 items-center gap-3 border-b border-border/60 px-4 py-2.5">
            <HugeiconsIcon
              icon={File01Icon}
              size={15}
              strokeWidth={1.8}
              className="shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-[13.5px] font-semibold">
                {shownPath?.name ?? ""}
              </DialogPrimitive.Title>
              {shownPath?.dir && (
                <div
                  className="terax-reader-mono terax-left-truncate text-[11px] text-muted-foreground"
                  title={path ?? undefined}
                >
                  <bdi>{shownPath.dir}</bdi>
                </div>
              )}
            </div>
            {path && (
              <button
                type="button"
                onClick={() => void openTerminalLink(path, cwd)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1 text-[12px] outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <HugeiconsIcon
                  icon={LinkSquare02Icon}
                  size={12}
                  strokeWidth={1.8}
                />
                Open in editor
              </button>
            )}
            <DialogPrimitive.Close
              aria-label="Close"
              title="Close (Esc)"
              className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
            </DialogPrimitive.Close>
          </div>
          {load.kind === "loading" && (
            <p className="px-4 py-6 text-[12.5px] text-muted-foreground">
              Loading…
            </p>
          )}
          {load.kind === "message" && (
            <p
              className={
                load.error
                  ? "px-4 py-6 text-[12.5px] text-[var(--reader-red)]"
                  : "px-4 py-6 text-[12.5px] text-muted-foreground"
              }
            >
              {load.text}
            </p>
          )}
          {load.kind === "ready" && path && (
            <FileReview
              key={path}
              path={path}
              sessionId={sessionId}
              original={load.original}
              current={load.current}
              newFile={load.newFile}
              repoRoot={load.repoRoot}
              onDeleted={onClose}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
