/**
 * Cursor-style review of one changed file: the file as it is now (Claude's
 * edits applied, so kept by default) against its earlier version, with Keep
 * and Undo on every change, Keep all / Undo all, and the text editable in
 * place. Your own edits show as changes too. Every change saves to disk;
 * a file Claude rewrites meanwhile is reloaded, never overwritten.
 */
import { cn } from "@/lib/utils";
import { languageCompartment } from "@/modules/editor/lib/extensions";
import { resolveLanguage } from "@/modules/editor/lib/languageResolver";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  acceptChunk,
  getChunks,
  getOriginalDoc,
  originalDocChangeEffect,
  rejectChunk,
  unifiedMergeView,
} from "@codemirror/merge";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  Annotation,
  ChangeSet,
  EditorState,
  type Extension,
} from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  Tick02Icon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { classHighlighter } from "@lezer/highlight";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { revertFile } from "./lib/changesClient";
import {
  changeAt,
  chunkStats,
  nextChange,
  saveDecision,
} from "./lib/fileReview";

/** How long typing pauses before the file is saved. */
const SAVE_DEBOUNCE_MS = 700;
/** How often the disk is checked for Claude's own writes while nothing is unsaved. */
const DISK_POLL_MS = 1_500;

/** Marks transactions that load the disk's text, so they don't trigger a save. */
const fromDisk = Annotation.define<boolean>();

/**
 * Per path, the earlier version with the changes you kept folded in, so a
 * reopened review only shows what's still unreviewed (for this app session).
 */
const keptBaselines = new Map<string, string>();

export function reviewBaseline(path: string, fallback: string): string {
  return keptBaselines.get(path) ?? fallback;
}

type ReadResult =
  | { kind: "text"; content: string }
  | { kind: "binary" }
  | { kind: "toolarge" };

async function readDisk(path: string): Promise<string | null> {
  try {
    const read = await invoke<ReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
    });
    return read.kind === "text" ? read.content : null;
  } catch {
    return null;
  }
}

type SaveState =
  | { kind: "saved" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

type Chunk = { from: number; to: number };

const REVIEW_THEME = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--reader-code-bg)",
    color: "var(--foreground)",
    fontSize: "var(--reader-review-size, 12.5px)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily:
      '"Red Hat Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    lineHeight: "1.6",
  },
  ".cm-content": { caretColor: "var(--foreground)" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "color-mix(in oklab, var(--muted-foreground) 70%, transparent)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--foreground) 4%, transparent)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklab, var(--foreground) 16%, transparent)",
  },
  ".cm-changedLine": {
    backgroundColor:
      "color-mix(in oklab, var(--reader-green) 11%, transparent) !important",
  },
  ".cm-changedText": {
    background:
      "color-mix(in oklab, var(--reader-green) 30%, transparent) !important",
  },
  ".cm-deletedChunk": {
    backgroundColor: "color-mix(in oklab, var(--reader-red) 10%, transparent)",
    paddingTop: "2px",
  },
  ".cm-deletedChunk .cm-deletedText, .cm-deletedChunk del": {
    background: "color-mix(in oklab, var(--reader-red) 28%, transparent)",
    textDecoration: "none",
  },
  ".cm-changeGutter": { width: "3px", paddingLeft: "1px" },
  ".cm-changedLineGutter": { backgroundColor: "var(--reader-green)" },
  ".cm-deletedLineGutter": { backgroundColor: "var(--reader-red)" },
  ".cm-chunkButtons": {
    position: "absolute",
    insetInlineEnd: "10px",
    display: "flex",
    gap: "4px",
    zIndex: "2",
  },
  ".cm-collapsedLines": {
    color: "var(--muted-foreground)",
    backgroundColor: "color-mix(in oklab, var(--foreground) 4%, transparent)",
    fontSize: "11px",
  },
});

/** Moves the cursor to the next (or previous) change and scrolls it into view. */
function jumpToChange(v: EditorView, direction: 1 | -1): boolean {
  const found = getChunks(v.state)?.chunks ?? [];
  const i = nextChange(
    found.map((c) => c.fromB),
    v.state.selection.main.head,
    direction,
  );
  const target = found[i];
  if (!target) return false;
  v.dispatch({
    selection: { anchor: target.fromB },
    effects: EditorView.scrollIntoView(target.fromB, { y: "center" }),
  });
  return true;
}

/** Keep / Undo on a change, as small buttons in its top-right corner. */
function chunkButton(
  type: "accept" | "reject",
  action: (e: MouseEvent) => void,
): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = type === "accept" ? "Keep" : "Undo";
  button.title =
    type === "accept"
      ? "Keep this change (it stays in the file)"
      : "Undo this change (back to the earlier version)";
  button.className = cn(
    "terax-review-chunk-button",
    type === "accept" ? "is-keep" : "is-undo",
  );
  button.onmousedown = (e) => e.preventDefault();
  button.onclick = action;
  return button;
}

export function FileReview({
  path,
  sessionId,
  original,
  current,
  newFile,
  repoRoot,
  onDeleted,
}: {
  path: string;
  /** The chat the file was changed in. */
  sessionId: string | null;
  /** The version Claude's changes are compared against. */
  original: string;
  /** The file on disk when the review opened. */
  current: string;
  /** The file didn't exist in that earlier version. */
  newFile: boolean;
  /** The git repository, when there is one (needed to delete a new file). */
  repoRoot: string | null;
  onDeleted: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const disk = useRef<string | null>(current);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [stats, setStats] = useState({ added: 0, removed: 0 });
  const [active, setActive] = useState(-1);
  const [save, setSave] = useState<SaveState>({ kind: "saved" });
  const saveRef = useRef(save);
  saveRef.current = save;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = useCallback((state: EditorState) => {
    const found = getChunks(state)?.chunks ?? [];
    setChunks(found.map((c) => ({ from: c.fromB, to: c.toB })));
    setStats(
      chunkStats(getOriginalDoc(state).toString(), state.doc.toString(), found),
    );
    setActive(
      changeAt(
        found.map((c) => ({ from: c.fromB, to: c.toB })),
        state.selection.main.head,
      ),
    );
  }, []);

  /** Writes the editor's text, unless Claude changed the file since we last saw it. */
  const saveNow = useCallback(
    async (force = false) => {
      const v = view.current;
      if (!v || saving.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const doc = v.state.doc.toString();
      saving.current = true;
      setSave({ kind: "saving" });
      try {
        const now = await readDisk(path);
        const decision = force ? "write" : saveDecision(now, disk.current, doc);
        if (decision === "conflict") {
          setSave({ kind: "conflict" });
          return;
        }
        if (decision === "write") {
          await invoke("fs_write_file", {
            path,
            content: doc,
            workspace: currentWorkspaceEnv(),
            source: "review",
            sessionId,
          });
        }
        disk.current = doc;
        // Typing may have continued while the write was in flight.
        setSave(
          view.current?.state.doc.toString() === doc
            ? { kind: "saved" }
            : { kind: "pending" },
        );
      } catch (error) {
        setSave({ kind: "error", message: String(error) });
      } finally {
        saving.current = false;
      }
    },
    [path, sessionId],
  );

  const scheduleSave = useCallback(() => {
    if (saveRef.current.kind === "conflict") return;
    setSave({ kind: "pending" });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveNow(), SAVE_DEBOUNCE_MS);
  }, [saveNow]);

  /** Replaces the editor's text with the disk's, keeping the comparison base. */
  const loadFromDisk = useCallback((text: string) => {
    const v = view.current;
    if (!v) return;
    disk.current = text;
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: text },
      annotations: fromDisk.of(true),
    });
    setSave({ kind: "saved" });
  }, []);

  // Build the editor once per file; the merge view then owns its own state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: built once per opened file
  useEffect(() => {
    let disposed = false;
    let created: EditorView | null = null;
    void resolveLanguage(path)
      .catch(() => null)
      .then((lang) => {
        if (disposed || !host.current) return;
        const extensions: Extension[] = [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          indentOnInput(),
          bracketMatching(),
          highlightSelectionMatches(),
          syntaxHighlighting(classHighlighter),
          languageCompartment.of(lang?.ext ?? []),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                void saveNow();
                return true;
              },
            },
            { key: "F7", run: (v) => jumpToChange(v, 1) },
            { key: "Shift-F7", run: (v) => jumpToChange(v, -1) },
            { key: "Mod-y", run: (v) => acceptChunk(v) },
            { key: "Mod-n", run: (v) => rejectChunk(v) },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          unifiedMergeView({
            original: reviewBaseline(path, original),
            mergeControls: chunkButton,
            highlightChanges: true,
            gutter: true,
            syntaxHighlightDeletions: true,
            collapseUnchanged: { margin: 3, minSize: 8 },
          }),
          REVIEW_THEME,
          EditorView.updateListener.of((u) => {
            const keptChanged =
              getOriginalDoc(u.startState) !== getOriginalDoc(u.state);
            if (keptChanged) {
              keptBaselines.set(path, getOriginalDoc(u.state).toString());
            }
            if (u.docChanged || keptChanged || u.selectionSet) refresh(u.state);
            const local = u.transactions.some((t) => !t.annotation(fromDisk));
            if (u.docChanged && local) scheduleSave();
          }),
        ];
        created = new EditorView({
          parent: host.current,
          state: EditorState.create({ doc: current, extensions }),
        });
        view.current = created;
        refresh(created.state);
        // Line heights change once the code font arrives; re-measure so clicks land true.
        void document.fonts?.ready.then(() => created?.requestMeasure());
        // Land on the first change.
        const first = getChunks(created.state)?.chunks[0];
        if (first) {
          created.dispatch({
            selection: { anchor: first.fromB },
            effects: EditorView.scrollIntoView(first.fromB, { y: "center" }),
          });
        }
      });
    return () => {
      disposed = true;
      // Unsaved typing goes to disk on close (unless it would overwrite Claude).
      if (created && saveTimer.current && saveRef.current.kind !== "conflict") {
        void saveNow();
      }
      created?.destroy();
      view.current = null;
    };
  }, [path]);

  // Follow Claude's own writes while nothing here is unsaved.
  useEffect(() => {
    const timer = setInterval(() => {
      const v = view.current;
      if (!v || saving.current || saveRef.current.kind !== "saved") return;
      void readDisk(path).then((text) => {
        if (text === null || text === disk.current) return;
        if (saveRef.current.kind !== "saved") return;
        loadFromDisk(text);
      });
    }, DISK_POLL_MS);
    return () => clearInterval(timer);
  }, [path, loadFromDisk]);

  const step = (direction: 1 | -1) => {
    const v = view.current;
    if (!v) return;
    jumpToChange(v, direction);
    v.focus();
  };

  const keepAll = () => {
    const v = view.current;
    if (!v) return;
    const base = getOriginalDoc(v.state);
    const doc = v.state.doc.toString();
    v.dispatch({
      effects: originalDocChangeEffect(
        v.state,
        ChangeSet.of([{ from: 0, to: base.length, insert: doc }], base.length),
      ),
    });
  };

  const undoAll = () => {
    const v = view.current;
    if (!v) return;
    v.dispatch({
      changes: {
        from: 0,
        to: v.state.doc.length,
        insert: getOriginalDoc(v.state).toString(),
      },
    });
  };

  const deleteFile = () => {
    if (!repoRoot) return;
    void revertFile(repoRoot, path, true)
      .then(onDeleted)
      .catch((error: unknown) =>
        setSave({ kind: "error", message: String(error) }),
      );
  };

  const pending = chunks.length;
  const canDelete = newFile && repoRoot !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
        <span className="text-[12px] font-medium tabular-nums">
          <span className="text-[var(--reader-green)]">+{stats.added}</span>{" "}
          <span className="text-[var(--reader-red)]">−{stats.removed}</span>
        </span>
        <div className="flex items-center gap-1 text-[11.5px] text-muted-foreground tabular-nums">
          <span>
            {pending === 0
              ? "No changes left to review"
              : `Change ${Math.max(active, 0) + 1} of ${pending}`}
          </span>
          <NavButton
            label="Previous change (Shift+F7)"
            icon={ArrowUp01Icon}
            disabled={pending === 0}
            onClick={() => step(-1)}
          />
          <NavButton
            label="Next change (F7)"
            icon={ArrowDown01Icon}
            disabled={pending === 0}
            onClick={() => step(1)}
          />
        </div>
        <SaveBadge
          save={save}
          onRetry={() => void saveNow()}
          onReload={() =>
            void readDisk(path).then(
              (text) => text !== null && loadFromDisk(text),
            )
          }
          onOverwrite={() => void saveNow(true)}
        />
        <div className="ml-auto flex items-center gap-1.5">
          {canDelete ? (
            <ToolbarButton
              icon={Delete02Icon}
              tone="danger"
              onClick={() =>
                confirmDelete ? deleteFile() : setConfirmDelete(true)
              }
              onBlur={() => setConfirmDelete(false)}
            >
              {confirmDelete
                ? "Click again to delete the file"
                : "Delete new file"}
            </ToolbarButton>
          ) : (
            <ToolbarButton
              icon={Undo02Icon}
              tone="danger"
              disabled={pending === 0}
              onClick={undoAll}
            >
              Undo all
            </ToolbarButton>
          )}
          <ToolbarButton
            icon={Tick02Icon}
            tone="primary"
            disabled={pending === 0}
            onClick={keepAll}
          >
            Keep all
          </ToolbarButton>
        </div>
      </div>
      {/* `terax-review-host` opts the editor out of any CSS zoom on the page
          (see the VS Code build): CodeMirror maps clicks wrongly under it. */}
      <div
        ref={host}
        className="terax-review-host min-h-0 flex-1 overflow-hidden"
      />
    </div>
  );
}

function SaveBadge({
  save,
  onRetry,
  onReload,
  onOverwrite,
}: {
  save: SaveState;
  onRetry: () => void;
  onReload: () => void;
  onOverwrite: () => void;
}) {
  if (save.kind === "conflict") {
    return (
      <span className="flex items-center gap-1.5 rounded-md bg-[color-mix(in_oklab,var(--agent-attention)_14%,transparent)] px-2 py-0.5 text-[11.5px] text-foreground">
        Claude changed this file while you were editing.
        <button
          type="button"
          onClick={onReload}
          className="font-medium underline-offset-2 hover:underline"
        >
          Reload
        </button>
        ·
        <button
          type="button"
          onClick={onOverwrite}
          className="font-medium underline-offset-2 hover:underline"
        >
          Keep mine
        </button>
      </span>
    );
  }
  if (save.kind === "error") {
    return (
      <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--reader-red)]">
        Couldn't save: {save.message}
        <button
          type="button"
          onClick={onRetry}
          className="font-medium underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </span>
    );
  }
  const label =
    save.kind === "saved"
      ? "Saved"
      : save.kind === "saving"
        ? "Saving…"
        : "Unsaved";
  return (
    <span className="text-[11px] text-muted-foreground" aria-live="polite">
      {label}
    </span>
  );
}

function ToolbarButton({
  icon,
  tone,
  disabled,
  onClick,
  onBlur,
  children,
}: {
  icon: typeof Tick02Icon;
  tone: "primary" | "danger";
  disabled?: boolean;
  onClick: () => void;
  onBlur?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onBlur={onBlur}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40",
        tone === "primary"
          ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-border/70 text-foreground hover:border-[color-mix(in_oklab,var(--reader-red)_60%,transparent)] hover:text-[var(--reader-red)]",
      )}
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={2} />
      {children}
    </button>
  );
}

function NavButton({
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
