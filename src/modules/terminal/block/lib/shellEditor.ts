import { buildTerminalTheme } from "@/styles/terminalTheme";
import {
  acceptCompletion,
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  closeCompletion,
  completionStatus,
  moveCompletionSelection,
  startCompletion,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  insertNewline,
} from "@codemirror/commands";
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  EditorView,
  keymap,
  placeholder,
  rectangularSelection,
  tooltips,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { completionIcon } from "./completionIcons";
import { historyOpen, historyPopover } from "./historyPopover";
import { inlineSuggestion } from "./inlineSuggest";
import { pathCompletions } from "./pathComplete";

const shellLanguage = StreamLanguage.define(shell);

export type ShellEditorOptions = {
  parent: HTMLElement;
  fontFamily: string;
  fontSize: number;
  placeholderText?: string;
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  /** Escape with no completion open; return true when handled. */
  onEscape?: () => boolean;
  /** Live command-name list (history first-words + PATH) for completion. */
  commandNames?: () => string[];
  /** Fish-style full-command autosuggestion for the current input line. */
  suggest?: (line: string) => Promise<string | null>;
  /** Recency-ranked history for the ArrowUp popover (Ctrl-R style). */
  historyList?: (query: string, limit: number) => Promise<string[]>;
  /** Live cwd of the terminal, for path completion in argument position. */
  getCwd?: () => string | null;
  /** Fires on every edit with the current text (used to gate empty-state UI). */
  onChange?: (text: string) => void;
};

export type ShellEditorHandle = {
  readonly view: EditorView;
  focus(): void;
  getValue(): string;
  setValue(text: string): void;
  clear(): void;
  setEditable(editable: boolean): void;
  retheme(fontFamily: string, fontSize: number): void;
  destroy(): void;
};

// Common shell keywords + frequently used commands. This is the static layer
// of "type a command, get a list"; the Rust history layer (later) ranks real
// usage on top. The dynamic layer below adds words already on screen.
const SHELL_KEYWORDS = [
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "do",
  "done",
  "case",
  "esac",
  "in",
  "function",
  "select",
  "until",
  "return",
  "break",
  "continue",
  "export",
  "unset",
  "alias",
  "unalias",
  "source",
  "set",
  "local",
  "read",
];
const SHELL_COMMANDS = [
  "cd",
  "ls",
  "pwd",
  "echo",
  "printf",
  "cat",
  "grep",
  "rg",
  "find",
  "fd",
  "awk",
  "sed",
  "sort",
  "uniq",
  "wc",
  "head",
  "tail",
  "less",
  "tee",
  "xargs",
  "cut",
  "tr",
  "diff",
  "touch",
  "mkdir",
  "rmdir",
  "rm",
  "cp",
  "mv",
  "ln",
  "chmod",
  "chown",
  "stat",
  "du",
  "df",
  "ps",
  "top",
  "htop",
  "kill",
  "jobs",
  "nohup",
  "env",
  "which",
  "man",
  "history",
  "clear",
  "exit",
  "ssh",
  "scp",
  "rsync",
  "curl",
  "wget",
  "ping",
  "tar",
  "gzip",
  "zip",
  "unzip",
  "make",
  "cmake",
  "gcc",
  "clang",
  "git",
  "gh",
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "deno",
  "python",
  "python3",
  "pip",
  "pip3",
  "cargo",
  "rustc",
  "rustup",
  "go",
  "docker",
  "kubectl",
  "helm",
  "terraform",
  "brew",
  "apt",
  "systemctl",
  "code",
  "vim",
  "nvim",
  "nano",
  "open",
];

const WORD_RE = /[\w./+-]*/;
const DOC_WORD_RE = /[A-Za-z_][\w./-]+/g;
const VALID_FOR = /^[\w./+-]*$/;
// Command position = start of a command segment: line start, or right after a
// separator (; & | newline ( { ), so the 2nd command in `a; b` completes too.
const SEGMENT_START = /(^|[\n;&|(){}])\s*$/;

function commandOptions(
  prefix: string,
  getCommands: () => string[],
): Completion[] {
  const names = getCommands();
  const src = names.length ? names : SHELL_COMMANDS;
  const out: Completion[] = [];
  for (const label of src) {
    if (label.startsWith(prefix)) {
      out.push({ label, type: "function" });
      if (out.length >= 50) break;
    }
  }
  for (const k of SHELL_KEYWORDS) {
    if (k.startsWith(prefix)) out.push({ label: k, type: "keyword" });
  }
  return out;
}

function docWordOptions(ctx: CompletionContext, current: string): Completion[] {
  const seen = new Set<string>([current]);
  const out: Completion[] = [];
  for (const m of ctx.state.doc.toString().matchAll(DOC_WORD_RE)) {
    const w = m[0];
    if (seen.has(w)) continue;
    seen.add(w);
    out.push({ label: w, type: "text" });
    if (out.length >= 50) break;
  }
  return out;
}

const PATH_VALID_FOR = /^[^/]*$/;

function makeCompletionSource(
  getCommands: () => string[],
  getCwd: () => string | null,
) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    if (historyOpen(ctx.state)) return null;
    const word = ctx.matchBefore(WORD_RE);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const line = ctx.state.doc.lineAt(word.from);
    const before = ctx.state.doc.sliceString(line.from, word.from);
    if (SEGMENT_START.test(before)) {
      return {
        from: word.from,
        options: commandOptions(word.text, getCommands),
        validFor: VALID_FOR,
      };
    }
    const cwd = getCwd();
    if (cwd) {
      const res = await pathCompletions(word.text, cwd);
      if (res?.options.length) {
        return {
          from: word.from + res.fromOffset,
          options: res.options,
          validFor: PATH_VALID_FOR,
        };
      }
    }
    return {
      from: word.from,
      options: docWordOptions(ctx, word.text),
      validFor: VALID_FOR,
    };
  };
}

// Map legacy-shell token styles to the live terminal palette so the input
// line is colored by the same theme the terminal grid uses.
function highlightStyle(): HighlightStyle {
  const c = buildTerminalTheme();
  const fg = c.foreground ?? "inherit";
  return HighlightStyle.define([
    { tag: t.keyword, color: c.magenta ?? fg },
    { tag: t.string, color: c.green ?? fg },
    { tag: t.comment, color: c.brightBlack ?? fg, fontStyle: "italic" },
    { tag: [t.number, t.bool, t.atom], color: c.yellow ?? fg },
    { tag: t.standard(t.variableName), color: c.cyan ?? fg },
    { tag: t.special(t.variableName), color: c.blue ?? fg },
    { tag: t.variableName, color: fg },
    { tag: t.operator, color: c.brightBlack ?? fg },
  ]);
}

function baseTheme(fontFamily: string, fontSize: number) {
  const c = buildTerminalTheme();
  const caret = c.cursor ?? c.foreground ?? "currentColor";
  return EditorView.theme({
    "&": {
      backgroundColor: "transparent",
      color: c.foreground ?? "inherit",
      fontSize: `${fontSize}px`,
      minHeight: "1.5em",
    },
    ".cm-content": {
      padding: "0 2px",
      fontFamily,
      caretColor: caret,
      lineHeight: "1.5",
      minHeight: "1.5em",
    },
    ".cm-line": { padding: "0", lineHeight: "1.5", minHeight: "1.5em" },
    ".cm-scroller": {
      fontFamily,
      lineHeight: "1.5",
      overflow: "auto",
      minHeight: "1.5em",
      maxHeight: "200px",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: caret },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: c.selectionBackground ?? "rgba(255,255,255,0.15)" },
    ".cm-placeholder": { color: "rgba(128,128,128,0.5)" },
    ".cm-ghost": { opacity: "0.4" },
    ".cm-tooltip": {
      backgroundColor: "var(--popover)",
      color: "var(--popover-foreground)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      overflow: "hidden",
      boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
    },
    ".cm-tooltip-autocomplete > ul": { fontFamily, maxHeight: "16rem" },
    ".cm-tooltip-autocomplete > ul > li": { padding: "2px 8px" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--accent, rgba(127,127,127,0.2))",
      color: "var(--accent-foreground, inherit)",
    },
    ".cm-completionIcon": { paddingRight: "0.6em", opacity: "0.7" },
  });
}

// Arrow keys drive the completion popup when it is open; each command returns
// false when no completion is active, so the keys fall through (e.g. to the
// history popover / cursor movement).
const completionNav = Prec.highest(
  keymap.of([
    { key: "ArrowDown", run: moveCompletionSelection(true) },
    { key: "ArrowUp", run: moveCompletionSelection(false) },
    { key: "Escape", run: closeCompletion },
  ]),
);

export function createShellEditor(opts: ShellEditorOptions): ShellEditorHandle {
  const themeComp = new Compartment();
  const highlightComp = new Compartment();
  const editableComp = new Compartment();

  const clear = (view: EditorView) =>
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "" },
    });

  const submitKeys = Prec.highest(
    keymap.of([
      {
        key: "Enter",
        run: (view) => {
          // Enter always runs the line (Tab is accept). Predictable shell UX.
          const text = view.state.doc.toString();
          if (!text.trim()) return true;
          opts.onSubmit(text);
          clear(view);
          return true;
        },
      },
      { key: "Shift-Enter", run: insertNewline },
      {
        key: "Tab",
        run: (view) =>
          completionStatus(view.state) === "active"
            ? acceptCompletion(view)
            : startCompletion(view),
      },
      {
        key: "Ctrl-c",
        run: (view) => {
          opts.onInterrupt();
          clear(view);
          return true;
        },
        preventDefault: true,
      },
    ]),
  );

  const state = EditorState.create({
    doc: "",
    extensions: [
      history(),
      drawSelection({ cursorBlinkRate: 1100 }),
      rectangularSelection(),
      crosshairCursor(),
      EditorState.allowMultipleSelections.of(true),
      EditorView.lineWrapping,
      tooltips({ parent: document.body }),
      shellLanguage,
      highlightComp.of(syntaxHighlighting(highlightStyle())),
      autocompletion({
        override: [
          makeCompletionSource(
            opts.commandNames ?? (() => []),
            opts.getCwd ?? (() => null),
          ),
        ],
        icons: false,
        defaultKeymap: false,
        addToOptions: [{ render: (c) => completionIcon(c.type), position: 20 }],
      }),
      completionNav,
      ...(opts.suggest ? inlineSuggestion(opts.suggest) : []),
      ...(opts.historyList ? historyPopover(opts.historyList) : []),
      placeholder(opts.placeholderText ?? "Run a command"),
      ...(opts.onChange
        ? [
            EditorView.updateListener.of((u) => {
              if (u.docChanged) opts.onChange?.(u.state.doc.toString());
            }),
          ]
        : []),
      submitKeys,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      ...(opts.onEscape
        ? [
            Prec.lowest(
              keymap.of([
                { key: "Escape", run: () => opts.onEscape?.() ?? false },
              ]),
            ),
          ]
        : []),
      editableComp.of(EditorView.editable.of(true)),
      themeComp.of(baseTheme(opts.fontFamily, opts.fontSize)),
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
    setEditable: (editable) =>
      view.dispatch({
        effects: editableComp.reconfigure(EditorView.editable.of(editable)),
      }),
    retheme: (fontFamily, fontSize) =>
      view.dispatch({
        effects: [
          themeComp.reconfigure(baseTheme(fontFamily, fontSize)),
          highlightComp.reconfigure(syntaxHighlighting(highlightStyle())),
        ],
      }),
    destroy: () => view.destroy(),
  };
}
