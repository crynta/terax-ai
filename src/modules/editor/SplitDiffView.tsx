import { defaultKeymap } from "@codemirror/commands";
import { foldGutter } from "@codemirror/language";
import { MergeView } from "@codemirror/merge";
import { searchKeymap } from "@codemirror/search";
import { Compartment, type Extension } from "@codemirror/state";
import {
  drawSelection,
  type EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import { SPLIT_DIFF_THEME } from "./lib/diffTheme";
import {
  buildSharedExtensions,
  languageCompartment,
  READONLY_EXTENSIONS,
} from "./lib/extensions";
import { resolveLanguage, resolveLanguageSync } from "./lib/languageResolver";
import { useEditorThemeExt } from "./lib/useEditorThemeExt";

type Props = {
  original: string;
  modified: string;
  path: string;
};

const SHARED_EXT = buildSharedExtensions();
const themeCompartment = new Compartment();

function replaceDoc(view: EditorView, doc: string): void {
  if (view.state.doc.toString() === doc) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: doc },
  });
}

export function SplitDiffView({ original, modified, path }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | null>(null);
  const themeExt = useEditorThemeExt();

  // Effects read initial values through refs so the MergeView is only
  // rebuilt on a path change; content and theme update in place below.
  const originalRef = useRef(original);
  originalRef.current = original;
  const modifiedRef = useRef(modified);
  modifiedRef.current = modified;
  const themeRef = useRef(themeExt);
  themeRef.current = themeExt;

  // MergeView is a plain class managing two EditorViews, not a CodeMirror
  // extension, so it cannot render through <CodeMirror>.
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    const lang = resolveLanguageSync(path);
    const sideExtensions: Extension[] = [
      ...SHARED_EXT,
      lineNumbers(),
      foldGutter(),
      highlightSpecialChars(),
      drawSelection(),
      keymap.of([...defaultKeymap, ...searchKeymap]),
      languageCompartment.of(lang?.ext ?? []),
      themeCompartment.of(themeRef.current),
      ...READONLY_EXTENSIONS,
      SPLIT_DIFF_THEME,
    ];
    const view = new MergeView({
      a: { doc: originalRef.current, extensions: sideExtensions },
      b: { doc: modifiedRef.current, extensions: sideExtensions },
      parent,
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    viewRef.current = view;
    let cancelled = false;
    if (!lang) {
      resolveLanguage(path)
        .then((res) => {
          if (cancelled) return;
          for (const side of [view.a, view.b]) {
            side.dispatch({
              effects: languageCompartment.reconfigure(res?.ext ?? []),
            });
          }
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      viewRef.current = null;
      view.destroy();
    };
  }, [path]);

  // Working diffs refetch on file save; replacing the docs in place keeps
  // scroll position and expanded regions, unlike a destroy/recreate.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    replaceDoc(view.a, original);
    replaceDoc(view.b, modified);
  }, [original, modified]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    for (const side of [view.a, view.b]) {
      side.dispatch({ effects: themeCompartment.reconfigure(themeExt) });
    }
  }, [themeExt]);

  return (
    <div
      ref={containerRef}
      className="h-full [&>.cm-mergeView]:h-full [&>.cm-mergeView]:overflow-auto"
    />
  );
}
