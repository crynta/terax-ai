/**
 * A file changed in this chat, shown whole with its changes in a dialog over
 * the Reader, so reviewing a change never leaves the session.
 */
import { cn } from "@/lib/utils";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { openTerminalLink } from "@/modules/terminal/lib/terminalFileLinks";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  File01Icon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { repoRelative } from "./lib/changes";
import { headChanges } from "./lib/changesClient";
import { repoFor } from "./lib/contextClient";
import {
  changeStarts,
  type FullRow,
  fullViewFromPatch,
  fullViewFromVersions,
  MAX_RENDER_ROWS,
  reverseApplyEdits,
  sessionEdits,
  splitDisplayPath,
  stepChange,
} from "./lib/fullFileDiff";
import type { ReaderDocument } from "./lib/transcript";

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
  | { kind: "ready"; rows: FullRow[]; source: "git" | "session" }
  | { kind: "binary" }
  | { kind: "error"; message: string };

async function loadRows(
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
    if (versions.binary) return { kind: "binary" };
    if (versions.head !== null && versions.working !== null && cwd) {
      // The patch keeps exact hunks even for long files; versions are the fallback.
      const live = await headChanges(cwd, [path]).catch(() => null);
      const change = live?.byPath.get(path);
      if (change && !change.truncated && change.diffText) {
        const rows = fullViewFromPatch(versions.working, change.diffText);
        if (rows) return { kind: "ready", rows, source: "git" };
      }
    }
    return {
      kind: "ready",
      rows: fullViewFromVersions(versions.head, versions.working),
      source: "git",
    };
  }
  const read = await invoke<ReadResult>("fs_read_file", {
    path,
    workspace: currentWorkspaceEnv(),
  });
  if (read.kind === "binary") return { kind: "binary" };
  if (read.kind === "toolarge")
    return { kind: "error", message: "This file is too large to show here." };
  const base = reverseApplyEdits(read.content, sessionEdits(doc, path, cwd));
  return {
    kind: "ready",
    rows: fullViewFromVersions(base, read.content),
    source: "session",
  };
}

export function FileDiffDialog({
  path,
  cwd,
  home,
  doc,
  onClose,
}: {
  path: string | null;
  cwd: string | null;
  home: string | null;
  doc: ReaderDocument;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [showAll, setShowAll] = useState(false);
  const [current, setCurrent] = useState(-1);
  const body = useRef<HTMLDivElement | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoad({ kind: "loading" });
    setShowAll(false);
    setCurrent(-1);
    void loadRows(path, cwd, docRef.current)
      .then((result) => live && setLoad(result))
      .catch(
        (error: unknown) =>
          live && setLoad({ kind: "error", message: String(error) }),
      );
    return () => {
      live = false;
    };
  }, [path, cwd]);

  const rows = load.kind === "ready" ? load.rows : [];
  const starts = useMemo(() => changeStarts(rows), [rows]);
  const added = rows.filter((r) => r.kind === "add").length;
  const removed = rows.filter((r) => r.kind === "remove").length;
  const limit = showAll ? rows.length : MAX_RENDER_ROWS;
  const shown = rows.length > limit ? rows.slice(0, limit) : rows;

  const goTo = useCallback(
    (index: number) => {
      setCurrent(index);
      const row = starts[index];
      if (row === undefined) return;
      if (row >= limit) setShowAll(true);
      requestAnimationFrame(() => {
        const el = body.current?.querySelector<HTMLElement>(
          `[data-row="${row}"]`,
        );
        el?.scrollIntoView({ block: "center" });
      });
    },
    [starts, limit],
  );

  // Open on the first change.
  useEffect(() => {
    if (load.kind === "ready" && starts.length > 0 && current === -1) goTo(0);
  }, [load.kind, starts, current, goTo]);

  const step = (direction: 1 | -1) =>
    goTo(stepChange(starts.length, current, direction));

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Keep keys inside the dialog: the Reader behind it has its own shortcuts.
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "j" || event.key === "ArrowDown") {
      if (event.key === "ArrowDown" && !event.shiftKey) return;
      event.preventDefault();
      step(1);
    } else if (event.key === "k" || event.key === "ArrowUp") {
      if (event.key === "ArrowUp" && !event.shiftKey) return;
      event.preventDefault();
      step(-1);
    }
  };

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
          onKeyDown={onKeyDown}
          onCloseAutoFocus={(event) => {
            // The Reader puts focus back in its composer itself.
            event.preventDefault();
          }}
          aria-describedby={undefined}
          className="terax-reader fixed top-1/2 left-1/2 z-[1001] flex h-[min(88vh,960px)] w-[min(1180px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background text-foreground shadow-2xl outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] motion-reduce:animate-none"
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
            {load.kind === "ready" && (
              <span className="shrink-0 text-[12px] font-medium tabular-nums">
                <span className="text-[var(--reader-green)]">+{added}</span>{" "}
                <span className="text-[var(--reader-red)]">−{removed}</span>
              </span>
            )}
            {starts.length > 0 && (
              <div className="flex shrink-0 items-center gap-1 text-[11.5px] text-muted-foreground tabular-nums">
                <span>
                  Change {Math.max(current, 0) + 1} of {starts.length}
                </span>
                <IconButton
                  label="Previous change (K)"
                  icon={ArrowUp01Icon}
                  disabled={current <= 0}
                  onClick={() => step(-1)}
                />
                <IconButton
                  label="Next change (J)"
                  icon={ArrowDown01Icon}
                  disabled={current >= starts.length - 1}
                  onClick={() => step(1)}
                />
              </div>
            )}
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
          <div
            ref={body}
            className="min-h-0 flex-1 overflow-auto bg-[var(--reader-code-bg)]"
          >
            {load.kind === "loading" && (
              <p className="px-4 py-6 text-[12.5px] text-muted-foreground">
                Loading…
              </p>
            )}
            {load.kind === "binary" && (
              <p className="px-4 py-6 text-[12.5px] text-muted-foreground">
                This is a binary file, so there's no line diff to show.
              </p>
            )}
            {load.kind === "error" && (
              <p className="px-4 py-6 text-[12.5px] text-[var(--reader-red)]">
                {load.message}
              </p>
            )}
            {load.kind === "ready" && (
              <>
                {load.source === "session" && (
                  <p className="border-b border-border/40 px-4 py-1.5 text-[11px] text-muted-foreground">
                    Not in a git repository: changes are worked out from this
                    chat's edits.
                  </p>
                )}
                {rows.length === 0 ? (
                  <p className="px-4 py-6 text-[12.5px] text-muted-foreground">
                    The file is empty.
                  </p>
                ) : (
                  <FullFileTable
                    rows={shown}
                    starts={starts}
                    current={current}
                  />
                )}
                {rows.length > shown.length && (
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="m-3 rounded-lg border border-border/70 px-3 py-1.5 text-[12px] outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    Show all {rows.length.toLocaleString()} lines
                  </button>
                )}
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FullFileTable({
  rows,
  starts,
  current,
}: {
  rows: readonly FullRow[];
  starts: readonly number[];
  current: number;
}) {
  const active = starts[current];
  return (
    <table className="terax-reader-mono w-full border-collapse text-[12px] leading-[1.6]">
      <tbody>
        {rows.map((row, i) => (
          <tr
            // Rows are positional: the table is rebuilt whenever the file changes.
            // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
            key={i}
            data-row={i}
            className={cn(
              row.kind === "add" && "terax-reader-diff-add",
              row.kind === "remove" && "terax-reader-diff-remove",
              i === active && "terax-reader-diff-current",
            )}
          >
            <td className="terax-reader-diff-gutter w-12 select-none px-2 text-right align-top text-[11px] text-muted-foreground/70 tabular-nums">
              {row.oldNo ?? ""}
            </td>
            <td className="terax-reader-diff-gutter w-12 select-none px-2 text-right align-top text-[11px] text-muted-foreground/70 tabular-nums">
              {row.newNo ?? ""}
            </td>
            <td className="terax-reader-diff-sign w-5 select-none text-center align-top text-muted-foreground">
              {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : ""}
            </td>
            <td className="whitespace-pre pr-4 align-top text-foreground/90">
              {row.text || " "}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function IconButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof ArrowUp01Icon;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40"
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={2} />
    </button>
  );
}
