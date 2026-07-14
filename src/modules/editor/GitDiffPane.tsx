import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  commitDiffKey,
  fetchCommitDiff,
  fetchWorkingDiff,
  getCachedDiff,
  workingDiffKey,
} from "./lib/diffCache";
import {
  buildSharedExtensions,
  DEFAULT_INDENT,
  languageCompartment,
} from "./lib/extensions";
import { resolveLanguage, resolveLanguageSync } from "./lib/languageResolver";
import { useEditorThemeExt } from "./lib/useEditorThemeExt";

type WorkingSource = {
  kind: "working";
  repoRoot: string;
  path: string;
  mode: "-" | "+";
  originalPath: string | null;
};

type CommitSource = {
  kind: "commit";
  repoRoot: string;
  sha: string;
  path: string;
  originalPath: string | null;
};

type Props = {
  source: WorkingSource | CommitSource;
  chipLabel?: string;
  active: boolean;
};

const LARGE_FILE_THRESHOLD = 256 * 1024;

const SHARED_EXT = buildSharedExtensions();
const READONLY_EXT = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];
const DIFF_THEME = EditorView.theme({
  "&.cm-merge-b .cm-changedText, .cm-changedText": {
    background: "rgba(110, 200, 120, 0.20) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  ".cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText": {
    background: "rgba(220, 90, 90, 0.22) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  "&.cm-merge-b .cm-changedLine, .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: "rgba(110, 200, 120, 0.05) !important",
  },
  ".cm-deletedChunk": {
    backgroundColor: "rgba(220, 90, 90, 0.05) !important",
    paddingTop: "1px",
    paddingBottom: "1px",
  },
  "&.cm-merge-b .cm-changedLineGutter, .cm-changedLineGutter": {
    background: "rgba(110, 200, 120, 0.55) !important",
  },
  ".cm-deletedLineGutter, &.cm-merge-a .cm-changedLineGutter": {
    background: "rgba(220, 90, 90, 0.5) !important",
  },
  ".cm-changeGutter": {
    width: "2px !important",
    paddingLeft: "0 !important",
  },
  ".cm-collapsedLines": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground, #9ca3af)",
    fontSize: "10.5px",
    padding: "2px 8px",
    opacity: 0.7,
  },
});

function countDiffLines(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (let i = 0; i < patch.length; i++) {
    if (i > 0 && patch.charCodeAt(i - 1) !== 10) continue;
    const c = patch.charCodeAt(i);
    if (c === 43 && patch.charCodeAt(i + 1) !== 43) added++;
    else if (c === 45 && patch.charCodeAt(i + 1) !== 45) removed++;
  }
  if (patch.length > 0 && patch.charCodeAt(0) === 43) added++;
  else if (patch.length > 0 && patch.charCodeAt(0) === 45) removed++;
  return { added, removed };
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "loaded";
      originalContent: string;
      modifiedContent: string;
      isBinary: boolean;
      fallbackPatch: string;
      /** Resolved before mount: a late compartment reconfigure would leave
       * the merge view's deleted-chunk widgets unhighlighted. */
      langExt: Extension | null;
    }
  | { kind: "error"; message: string };

function cacheKey(source: WorkingSource | CommitSource): string {
  return source.kind === "working"
    ? workingDiffKey(source.repoRoot, source.path, source.mode)
    : commitDiffKey(source.repoRoot, source.sha, source.path);
}

function loadStateFromCache(source: WorkingSource | CommitSource): LoadState {
  const hit = getCachedDiff(cacheKey(source));
  if (!hit) return { kind: "idle" };
  return {
    kind: "loaded",
    originalContent: hit.originalContent,
    modifiedContent: hit.modifiedContent,
    isBinary: hit.isBinary,
    fallbackPatch: hit.fallbackPatch,
    langExt: resolveLanguageSync(source.path)?.ext ?? null,
  };
}

export function GitDiffPane({ source, chipLabel, active }: Props) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const themeExt = useEditorThemeExt();
  const [state, setState] = useState<LoadState>(() =>
    active ? loadStateFromCache(source) : { kind: "idle" },
  );

  const key = cacheKey(source);

  useEffect(() => {
    if (!active) return;
    const cached = loadStateFromCache(source);
    if (cached.kind === "loaded") {
      setState(cached);
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    const promise =
      source.kind === "working"
        ? fetchWorkingDiff(
            source.repoRoot,
            source.path,
            source.mode,
            source.originalPath,
          )
        : fetchCommitDiff(
            source.repoRoot,
            source.sha,
            source.path,
            source.originalPath,
          );
    Promise.all([promise, resolveLanguage(source.path).catch(() => null)])
      .then(([res, lang]) => {
        if (cancelled) return;
        setState({
          kind: "loaded",
          originalContent: res.originalContent,
          modifiedContent: res.modifiedContent,
          isBinary: res.isBinary,
          fallbackPatch: res.fallbackPatch,
          langExt: lang?.ext ?? null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            err && typeof err === "object" && "message" in err
              ? String((err as { message: unknown }).message)
              : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [active, key, source]);

  const path = source.path;
  const repoRoot = source.repoRoot;
  const mode = source.kind === "working" ? source.mode : "+";
  const loaded = state.kind === "loaded" ? state : null;
  const originalContent = loaded?.originalContent ?? "";
  const modifiedContent = loaded?.modifiedContent ?? "";
  const isBinary = loaded?.isBinary ?? false;
  const fallbackPatch = loaded?.fallbackPatch ?? "";

  const isTooLarge =
    originalContent.length > LARGE_FILE_THRESHOLD ||
    modifiedContent.length > LARGE_FILE_THRESHOLD;
  const useFallback = isBinary || isTooLarge;

  const langExt = loaded?.langExt ?? null;
  const extensions = useMemo(
    () => [
      ...SHARED_EXT,
      DEFAULT_INDENT,
      languageCompartment.of(langExt ?? []),
      ...READONLY_EXT,
      unifiedMergeView({
        original: originalContent,
        mergeControls: false,
        highlightChanges: true,
        gutter: true,
        syntaxHighlightDeletions: true,
        collapseUnchanged: { margin: 3, minSize: 6 },
      }),
      DIFF_THEME,
    ],
    [originalContent, langExt],
  );

  // Cache-hit path only: the diff came from the cache before the language
  // pack was imported. Resolve and reconfigure once the view exists.
  useEffect(() => {
    if (useFallback || state.kind !== "loaded" || state.langExt) return;
    let cancelled = false;
    resolveLanguage(path).then((res) => {
      if (cancelled || !res) return;
      setState((s) =>
        s.kind === "loaded" ? { ...s, langExt: res.ext } : s,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [useFallback, path, state]);

  const stats = useMemo(
    () =>
      useFallback ? countDiffLines(fallbackPatch) : { added: 0, removed: 0 },
    [useFallback, fallbackPatch],
  );

  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border border-border/60 bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wide"
          >
            {chipLabel ?? mode}
          </Badge>
          {isBinary ? (
            <Badge variant="secondary" className="text-[10px]">
              Binary / patch fallback
            </Badge>
          ) : isTooLarge ? (
            <Badge variant="secondary" className="text-[10px]">
              Large file / patch view
            </Badge>
          ) : null}
          <span
            className="truncate font-mono text-[11px] text-muted-foreground"
            title={path}
          >
            {path}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[10.5px] tabular-nums text-muted-foreground">
          <span className="truncate max-w-80 font-mono">{repoRoot}</span>
          {useFallback ? (
            <>
              <span className="text-emerald-600 dark:text-emerald-400">
                +{stats.added}
              </span>
              <span className="text-rose-600 dark:text-rose-400">
                −{stats.removed}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {state.kind === "loading" || state.kind === "idle" ? (
          <div className="flex h-full items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <Spinner className="size-3" />
            Loading diff…
          </div>
        ) : state.kind === "error" ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[11.5px] text-destructive">
            {state.message}
          </div>
        ) : useFallback ? (
          <ScrollArea className="h-full">
            <pre className="min-h-full whitespace-pre-wrap wrap-break-word p-4 font-mono text-[12px] leading-relaxed text-muted-foreground">
              {fallbackPatch || "Diff preview is not available for this file."}
            </pre>
          </ScrollArea>
        ) : (
          <CodeMirror
            ref={cmRef}
            value={modifiedContent}
            theme={themeExt}
            extensions={extensions}
            editable={false}
            height="100%"
            className="h-full"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              searchKeymap: true,
            }}
          />
        )}
      </div>
    </div>
  );
}
