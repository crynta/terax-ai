import {
  Language,
  LanguageDescription,
  LanguageSupport,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LANGUAGES } from "./languageDefinitions";

// Fence-info strings (```ts, ```python) resolve against the same lazy
// loaders as file extensions; nothing loads until a fence names it. Lives
// in this lazy chunk so languageDefinitions stays out of the eager bundle.
let mdCodeLanguages: LanguageDescription[] | null = null;
export function markdownCodeLanguages(): LanguageDescription[] {
  if (mdCodeLanguages) return mdCodeLanguages;
  mdCodeLanguages = LANGUAGES.filter(
    (l) => l.name !== "Markdown" && l.name !== "Terax Theme",
  ).map((l) =>
    LanguageDescription.of({
      name: l.name,
      alias: l.extensions,
      extensions: l.extensions,
      load: async () => {
        const ext = await l.loader();
        if (ext instanceof LanguageSupport) return ext;
        if (ext instanceof Language) return new LanguageSupport(ext);
        throw new Error(`${l.name} is not usable inside markdown fences`);
      },
    }),
  );
  return mdCodeLanguages;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g;

const urlMatcher = new MatchDecorator({
  regexp: URL_RE,
  decoration: Decoration.mark({
    class: "cm-md-url",
    attributes: { title: "Cmd/Ctrl+Click to open" },
  }),
});

const urlHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = urlMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = urlMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

function urlAt(view: EditorView, pos: number): string | null {
  const line = view.state.doc.lineAt(pos);
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(line.text)) !== null) {
    const from = line.from + m.index;
    if (from > pos) break;
    if (pos <= from + m[0].length) return m[0];
  }
  return null;
}

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/;

const clickHandlers = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    if (event.button !== 0) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;

    if (event.metaKey || event.ctrlKey) {
      const url = urlAt(view, pos);
      if (!url) return false;
      void openUrl(url).catch(console.error);
      return true;
    }

    const line = view.state.doc.lineAt(pos);
    const m = TASK_RE.exec(line.text);
    if (!m) return false;
    const boxPos = line.from + m[1].length;
    if (pos < boxPos - 1 || pos > boxPos + 2) return false;
    view.dispatch({
      changes: {
        from: boxPos,
        to: boxPos + 1,
        insert: m[2] === " " ? "x" : " ",
      },
      userEvent: "input",
    });
    return true;
  },
});

const mdTheme = EditorView.theme({
  ".cm-md-url": {
    color: "var(--primary)",
    textDecoration: "underline",
    textUnderlineOffset: "2.5px",
    textDecorationColor: "color-mix(in srgb, var(--primary) 45%, transparent)",
  },
});

export function markdownExtras(): Extension {
  return [urlHighlighter, clickHandlers, mdTheme];
}
