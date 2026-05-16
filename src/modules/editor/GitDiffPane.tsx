import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { presentableDiff, unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef } from "react";
import { buildSharedExtensions, languageCompartment } from "./lib/extensions";
import { resolveLanguage } from "./lib/languageResolver";
import { EDITOR_THEME_EXT } from "./lib/themes";

type Props = {
  path: string;
  repoRoot: string;
  mode: "-" | "+";
  originalContent: string;
  modifiedContent: string;
  isBinary: boolean;
  fallbackPatch: string;
};

const DIFF_THEME = EditorView.theme({
  ".cm-changedText": {
    background: "color-mix(in srgb, var(--primary) 18%, transparent) !important",
  },
});

export function GitDiffPane({
  path,
  repoRoot,
  mode,
  originalContent,
  modifiedContent,
  isBinary,
  fallbackPatch,
}: Props) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const editorThemeId = usePreferencesStore((s) => s.editorTheme);
  const themeExt = EDITOR_THEME_EXT[editorThemeId] ?? EDITOR_THEME_EXT.atomone;

  const extensions = useMemo(
    () => [
      ...buildSharedExtensions(),
      languageCompartment.of([]),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
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
    [originalContent],
  );

  useEffect(() => {
    if (isBinary) return;
    let cancelled = false;
    resolveLanguage(path).then((ext) => {
      if (cancelled) return;
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: languageCompartment.reconfigure(ext ?? []),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isBinary, path]);

  const stats = useMemo(
    () => computeLineStats(originalContent, modifiedContent),
    [originalContent, modifiedContent],
  );

  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border border-border/60 bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wide"
          >
            {mode}
          </Badge>
          {isBinary ? (
            <Badge variant="secondary" className="text-[10px]">
              Binary / patch fallback
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
          <span className="text-emerald-600 dark:text-emerald-400">
            +{stats.added}
          </span>
          <span className="text-rose-600 dark:text-rose-400">
            −{stats.removed}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isBinary ? (
          <ScrollArea className="h-full">
            <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-muted-foreground">
              {fallbackPatch ||
                "Binary diff preview is not available for this file."}
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

function computeLineStats(
  original: string,
  proposed: string,
): { added: number; removed: number } {
  const changes = presentableDiff(original, proposed);
  let added = 0;
  let removed = 0;
  for (const c of changes) {
    removed += countLines(original, c.fromA, c.toA);
    added += countLines(proposed, c.fromB, c.toB);
  }
  return { added, removed };
}

function countLines(doc: string, from: number, to: number): number {
  if (from === to) return 0;
  const slice = doc.slice(from, to);
  let n = 1;
  for (let i = 0; i < slice.length; i++) {
    if (slice.charCodeAt(i) === 10) n++;
  }
  if (slice.endsWith("\n")) n--;
  return Math.max(n, 1);
}
