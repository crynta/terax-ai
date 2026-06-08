import { detectMonoFontFamily } from "@/lib/fonts";
import { indentUnit } from "@codemirror/language";
import { lintGutter } from "@codemirror/lint";
import { search } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Compartments allow runtime reconfiguration without rebuilding state.
export const languageCompartment = new Compartment();
export const readOnlyCompartment = new Compartment();
export const wrapCompartment = new Compartment();
export const vimCompartment = new Compartment();
export const lspCompartment = new Compartment();

// Only what basicSetup doesn't already cover, to avoid duplicate extensions.
// basicSetup gives us line numbers, fold gutter, history, indentOnInput,
// bracketMatching, closeBrackets, autocompletion, highlightActiveLine,
// highlightSelectionMatches and the search keymap.
export function buildSharedExtensions(): Extension[] {
  return [
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    search({ top: true }),
    lintGutter(),
    EditorView.theme({
      "&, &.cm-editor, &.cm-editor.cm-focused": {
        backgroundColor: "transparent !important",
        color: "var(--foreground)",
        outline: "none",
        padding: "8px",
      },
      ".cm-scroller": {
        fontFamily: detectMonoFontFamily(),
        fontSize: "13px",
        lineHeight: "1.55",
        backgroundColor: "transparent !important",
      },
      ".cm-content": {
        caretColor: "var(--foreground)",
        backgroundColor: "transparent !important",
      },
      ".cm-gutters": {
        backgroundColor: "transparent !important",
        color: "var(--muted-foreground)",
      },
      ".cm-gutter-lint": {
        width: "14px",
      },
      ".cm-lint-marker-error": {
        content: '"●"',
        color: "var(--destructive)",
      },
      ".cm-lint-marker-warning": {
        content: '"●"',
        color: "color-mix(in srgb, var(--foreground) 55%, transparent)",
      },
      ".cm-lintRange-error": {
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='m0 3 l2 -2 l1 0 l2 2' fill='none' stroke='%23ef4444' stroke-width='1'/%3E%3C/svg%3E\")",
        backgroundRepeat: "repeat-x",
        backgroundPosition: "left bottom",
        paddingBottom: "2px",
      },
      ".cm-lintRange-warning": {
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='m0 3 l2 -2 l1 0 l2 2' fill='none' stroke='%23eab308' stroke-width='1'/%3E%3C/svg%3E\")",
        backgroundRepeat: "repeat-x",
        backgroundPosition: "left bottom",
        paddingBottom: "2px",
      },
      ".cm-lsp-definition-link": {
        textDecoration: "underline",
        textDecorationColor: "color-mix(in srgb, var(--primary) 75%, transparent)",
        textUnderlineOffset: "2px",
        cursor: "pointer",
      },
      ".cm-gutter": { backgroundColor: "transparent !important" },
      ".cm-lineNumbers .cm-gutterElement": {
        opacity: "0.55",
      },
      ".cm-lineNumbers .cm-gutterElement.cm-lsp-inactive-lineNumber": {
        opacity: "0.28",
        color: "color-mix(in srgb, var(--muted-foreground) 70%, transparent)",
      },
      ".cm-line.cm-lsp-inactive-line": {
        opacity: "0.42",
      },
      ".cm-lsp-inlay-hint": {
        marginLeft: "0.35em",
        padding: "0 0.25em",
        borderRadius: "3px",
        fontSize: "0.85em",
        fontStyle: "italic",
        color: "color-mix(in srgb, var(--muted-foreground) 88%, transparent)",
        backgroundColor:
          "color-mix(in srgb, var(--foreground) 5%, transparent)",
        pointerEvents: "none",
        userSelect: "none",
      },
      ".cm-foldGutter": { width: "10px" },
      ".cm-foldGutter .cm-gutterElement": {
        color: "var(--muted-foreground)",
        opacity: "0.5",
      },
      ".cm-activeLine": {
        borderTopRightRadius: "5px",
        borderBottomRightRadius: "5px",
        backgroundColor:
          "color-mix(in srgb, var(--foreground) 4%, transparent)",
      },
      ".cm-lineNumbers .cm-activeLineGutter": {
        borderTopLeftRadius: "5px",
        borderBottomLeftRadius: "5px",
        userSelect: "none",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--foreground)",
      },
      // Vim normal-mode block cursor — translucent foreground, no rose hue.
      ".cm-fat-cursor": {
        background:
          "color-mix(in srgb, var(--foreground) 35%, transparent) !important",
        outline:
          "1px solid color-mix(in srgb, var(--foreground) 55%, transparent) !important",
        color: "var(--foreground) !important",
      },
      "&:not(.cm-focused) .cm-fat-cursor": {
        background: "transparent !important",
        outline:
          "1px solid color-mix(in srgb, var(--foreground) 35%, transparent) !important",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
        {
          backgroundColor:
            "color-mix(in srgb, var(--foreground) 18%, transparent) !important",
        },
      ".cm-tooltip.cm-tooltip-hover": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        boxShadow: "0 4px 12px color-mix(in srgb, var(--foreground) 12%, transparent)",
        maxWidth: "32rem",
      },
      ".cm-tooltip.cm-tooltip-hover .cm-lsp-hover": {
        maxHeight: "20rem",
      },
      ".cm-panels": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        borderColor: "var(--border)",
      },
    }),
  ];
}
