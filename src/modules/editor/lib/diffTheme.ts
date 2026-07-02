import { EditorView } from "@codemirror/view";

// Single source for the diff palette so the unified and split views cannot
// drift apart when colors are tuned.
const ADDED_TEXT = "rgba(110, 200, 120, 0.20) !important";
const ADDED_LINE = "rgba(110, 200, 120, 0.05) !important";
const ADDED_GUTTER = "rgba(110, 200, 120, 0.55) !important";
const REMOVED_TEXT = "rgba(220, 90, 90, 0.22) !important";
const REMOVED_LINE = "rgba(220, 90, 90, 0.05) !important";
const REMOVED_GUTTER = "rgba(220, 90, 90, 0.5) !important";

const CHANGED_TEXT_SHAPE = {
  borderRadius: "3px",
  padding: "0 1px",
};

const SHARED_RULES = {
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
};

export const UNIFIED_DIFF_THEME = EditorView.theme({
  "&.cm-merge-b .cm-changedText, .cm-changedText": {
    background: ADDED_TEXT,
    ...CHANGED_TEXT_SHAPE,
  },
  ".cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText": {
    background: REMOVED_TEXT,
    ...CHANGED_TEXT_SHAPE,
  },
  "&.cm-merge-b .cm-changedLine, .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: ADDED_LINE,
  },
  ".cm-deletedChunk": {
    backgroundColor: REMOVED_LINE,
    paddingTop: "1px",
    paddingBottom: "1px",
  },
  "&.cm-merge-b .cm-changedLineGutter, .cm-changedLineGutter": {
    background: ADDED_GUTTER,
  },
  ".cm-deletedLineGutter, &.cm-merge-a .cm-changedLineGutter": {
    background: REMOVED_GUTTER,
  },
  ...SHARED_RULES,
});

// MergeView roots carry .cm-merge-a (original) and .cm-merge-b (modified),
// so deletions read red on the left and insertions green on the right.
export const SPLIT_DIFF_THEME = EditorView.theme({
  "&.cm-merge-a .cm-changedText": {
    background: REMOVED_TEXT,
    ...CHANGED_TEXT_SHAPE,
  },
  "&.cm-merge-a .cm-changedLine": {
    backgroundColor: REMOVED_LINE,
  },
  "&.cm-merge-a .cm-changedLineGutter": {
    background: REMOVED_GUTTER,
  },
  "&.cm-merge-b .cm-changedText": {
    background: ADDED_TEXT,
    ...CHANGED_TEXT_SHAPE,
  },
  "&.cm-merge-b .cm-changedLine": {
    backgroundColor: ADDED_LINE,
  },
  "&.cm-merge-b .cm-changedLineGutter": {
    background: ADDED_GUTTER,
  },
  ...SHARED_RULES,
});
