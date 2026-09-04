import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { wordWrapExtension } from "./extensions";

describe("wordWrapExtension", () => {
  it("enables native line wrapping at the configured width", () => {
    const state = EditorState.create({
      extensions: [wordWrapExtension(80)],
    });

    expect(state.facet(EditorView.contentAttributes)).toEqual(
      expect.arrayContaining([
        { class: "cm-lineWrapping" },
        { style: "--terax-editor-wrap-column: 80ch" },
      ]),
    );
  });

  it("adds no content attributes when disabled", () => {
    const state = EditorState.create({
      extensions: [wordWrapExtension(null)],
    });

    expect(state.facet(EditorView.contentAttributes)).toEqual([]);
  });

  it("reuses the wrap theme across column changes", () => {
    const first = wordWrapExtension(80) as readonly Extension[];
    const second = wordWrapExtension(120) as readonly Extension[];

    expect(first[1]).toBe(second[1]);
  });
});
