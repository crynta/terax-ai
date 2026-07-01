import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  Compartment,
  type Extension,
  EditorState,
  Prec,
} from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  keymap,
  placeholder,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { KeyBinding } from "@/modules/shortcuts";
import { composerShellCompletionSource } from "./composerShellCompletion";

export type ComposerEditorOptions = {
  parent: HTMLElement;
  doc: string;
  fontFamily: string;
  fontSize: number;
  sendKeys: string[];
  queueKeys: string[];
  shellCompletion: boolean;
  syntaxExtension: Extension;
  onChange: (text: string) => void;
  onSend: (text: string) => boolean;
  onQueue: (text: string) => boolean;
  onClose: () => void;
};

export type ComposerEditorHandle = {
  readonly view: EditorView;
  focus: () => void;
  getValue: () => string;
  setValue: (text: string) => void;
  clear: () => void;
  retheme: (fontFamily: string, fontSize: number) => void;
  setSyntaxExtension: (extension: Extension) => void;
  destroy: () => void;
};

function editorTheme(fontFamily: string, fontSize: number) {
  return EditorView.theme({
    "&": {
      "--composer-syntax-heading":
        "color-mix(in srgb, var(--terminal-ansi-bright-magenta, #c084fc) 86%, var(--foreground))",
      "--composer-syntax-keyword":
        "color-mix(in srgb, var(--terminal-ansi-bright-cyan, #22d3ee) 86%, var(--foreground))",
      "--composer-syntax-string":
        "color-mix(in srgb, var(--terminal-ansi-bright-green, #4ade80) 82%, var(--foreground))",
      "--composer-syntax-comment":
        "color-mix(in srgb, var(--terminal-ansi-bright-black, #71717a) 82%, var(--foreground))",
      "--composer-syntax-number":
        "color-mix(in srgb, var(--terminal-ansi-bright-yellow, #facc15) 76%, var(--foreground))",
      "--composer-syntax-variable":
        "color-mix(in srgb, var(--terminal-ansi-bright-blue, #60a5fa) 84%, var(--foreground))",
      "--composer-syntax-operator":
        "color-mix(in srgb, var(--terminal-ansi-white, #a1a1aa) 68%, var(--foreground))",
      "--composer-syntax-tag":
        "color-mix(in srgb, var(--terminal-ansi-bright-red, #f87171) 84%, var(--foreground))",
      "--composer-syntax-link":
        "color-mix(in srgb, var(--terminal-ansi-bright-blue, #60a5fa) 90%, var(--foreground))",
      backgroundColor: "transparent",
      color: "var(--foreground)",
      fontSize: `${fontSize}px`,
      height: "100%",
      minHeight: "100%",
    },
    ".cm-content": {
      caretColor: "var(--foreground)",
      fontFamily,
      lineHeight: "1.5",
      minHeight: "100%",
      padding: "0",
    },
    ".cm-line": {
      padding: "0",
      lineHeight: "1.5",
    },
    ".cm-scroller": {
      fontFamily,
      lineHeight: "1.5",
      height: "100%",
      maxHeight: "100%",
      overflow: "auto",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--foreground)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "var(--accent)",
      },
    ".cm-placeholder": {
      color: "var(--muted-foreground)",
    },
  });
}

const composerHighlightStyle = HighlightStyle.define([
  {
    tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4],
    color: "var(--composer-syntax-heading)",
    fontWeight: "700",
  },
  { tag: t.keyword, color: "var(--composer-syntax-keyword)" },
  {
    tag: [t.string, t.special(t.string)],
    color: "var(--composer-syntax-string)",
  },
  {
    tag: t.comment,
    color: "var(--composer-syntax-comment)",
    fontStyle: "italic",
  },
  { tag: [t.number, t.bool, t.atom], color: "var(--composer-syntax-number)" },
  {
    tag: [t.variableName, t.definition(t.variableName)],
    color: "var(--composer-syntax-variable)",
  },
  {
    tag: [t.operator, t.punctuation],
    color: "var(--composer-syntax-operator)",
  },
  { tag: [t.tagName, t.attributeName], color: "var(--composer-syntax-tag)" },
  { tag: t.link, color: "var(--composer-syntax-link)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
]);

export function codeMirrorKeyForBinding(binding: KeyBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push("Ctrl");
  if (binding.alt) parts.push("Alt");
  if (binding.shift) parts.push("Shift");
  if (binding.meta) parts.push("Meta");
  const key = binding.key === " " ? "Space" : binding.key;
  parts.push(key);
  return parts.join("-");
}

export function createComposerEditor(
  opts: ComposerEditorOptions,
): ComposerEditorHandle {
  const clear = (view: EditorView) => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "" },
    });
  };
  const themeComp = new Compartment();
  const syntaxComp = new Compartment();

  const submitKeys = Prec.highest(
    keymap.of([
      ...opts.sendKeys.map((key) => ({
        key,
        run: (view: EditorView) => {
          if (!opts.onSend(view.state.doc.toString())) return true;
          clear(view);
          return true;
        },
      })),
      ...opts.queueKeys.map((key) => ({
        key,
        run: (view: EditorView) => {
          if (!opts.onQueue(view.state.doc.toString())) return true;
          clear(view);
          return true;
        },
      })),
      {
        key: "Escape",
        run: () => {
          opts.onClose();
          return true;
        },
      },
    ]),
  );

  const state = EditorState.create({
    doc: opts.doc,
    extensions: [
      history(),
      drawSelection({ cursorBlinkRate: 1100 }),
      EditorState.allowMultipleSelections.of(true),
      EditorView.lineWrapping,
      placeholder("Draft terminal input"),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) opts.onChange(update.state.doc.toString());
      }),
      submitKeys,
      closeBrackets(),
      bracketMatching(),
      autocompletion({
        override: opts.shellCompletion ? [composerShellCompletionSource] : undefined,
      }),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      syntaxComp.of(opts.syntaxExtension),
      syntaxHighlighting(composerHighlightStyle, { fallback: true }),
      themeComp.of(editorTheme(opts.fontFamily, opts.fontSize)),
    ],
  });

  const view = new EditorView({ state, parent: opts.parent });

  return {
    view,
    focus: () => view.focus(),
    getValue: () => view.state.doc.toString(),
    setValue: (text) =>
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: text.length },
      }),
    clear: () => clear(view),
    retheme: (fontFamily, fontSize) => {
      view.dispatch({
        effects: themeComp.reconfigure(editorTheme(fontFamily, fontSize)),
      });
    },
    setSyntaxExtension: (extension) => {
      view.dispatch({
        effects: syntaxComp.reconfigure(extension),
      });
    },
    destroy: () => view.destroy(),
  };
}
