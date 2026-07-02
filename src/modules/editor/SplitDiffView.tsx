import { MergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import { buildSharedExtensions, languageCompartment } from "./lib/extensions";
import { resolveLanguage, resolveLanguageSync } from "./lib/languageResolver";
import { useEditorThemeExt } from "./lib/useEditorThemeExt";

type Props = {
  original: string;
  modified: string;
  path: string;
};

const SHARED_EXT = buildSharedExtensions();
const READONLY_EXT = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];

// Editor A holds the original (deletions, red); editor B the modified
// (insertions, green). Scoped by the .cm-merge-a/.cm-merge-b root classes
// MergeView puts on each side.
const SPLIT_DIFF_THEME = EditorView.theme({
  "&.cm-merge-a .cm-changedText": {
    background: "rgba(220, 90, 90, 0.22) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  "&.cm-merge-a .cm-changedLine": {
    backgroundColor: "rgba(220, 90, 90, 0.05) !important",
  },
  "&.cm-merge-a .cm-changedLineGutter": {
    background: "rgba(220, 90, 90, 0.5) !important",
  },
  "&.cm-merge-b .cm-changedText": {
    background: "rgba(110, 200, 120, 0.20) !important",
    borderRadius: "3px",
    padding: "0 1px",
  },
  "&.cm-merge-b .cm-changedLine": {
    backgroundColor: "rgba(110, 200, 120, 0.05) !important",
  },
  "&.cm-merge-b .cm-changedLineGutter": {
    background: "rgba(110, 200, 120, 0.55) !important",
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

export function SplitDiffView({ original, modified, path }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const themeExt = useEditorThemeExt();
  const initialLang = useMemo(() => resolveLanguageSync(path), [path]);

  // MergeView is a plain class managing two EditorViews, not a CodeMirror
  // extension, so it cannot go through <CodeMirror>. Rebuild on any input
  // change; diff panes are read-only so there is no editor state to preserve.
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    const sideExtensions: Extension[] = [
      ...SHARED_EXT,
      lineNumbers(),
      languageCompartment.of(initialLang?.ext ?? []),
      ...READONLY_EXT,
      themeExt,
      SPLIT_DIFF_THEME,
    ];
    const view = new MergeView({
      a: { doc: original, extensions: sideExtensions },
      b: { doc: modified, extensions: sideExtensions },
      parent,
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    let cancelled = false;
    if (!initialLang) {
      void resolveLanguage(path).then((res) => {
        if (cancelled || !res) return;
        view.a.dispatch({
          effects: languageCompartment.reconfigure(res.ext),
        });
        view.b.dispatch({
          effects: languageCompartment.reconfigure(res.ext),
        });
      });
    }
    return () => {
      cancelled = true;
      view.destroy();
    };
  }, [original, modified, path, initialLang, themeExt]);

  return (
    <div
      ref={containerRef}
      className="h-full [&>.cm-mergeView]:h-full [&>.cm-mergeView]:overflow-auto"
    />
  );
}
