import { insertBracket } from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";
import { describe, expect, it, vi } from "vitest";

import {
  composerHighlightStyle,
  createComposerEditorState,
  type ComposerEditorOptions,
} from "./composerEditor";

const baseOptions: ComposerEditorOptions = {
  parent: null as unknown as HTMLElement,
  doc: "",
  fontFamily: "monospace",
  fontSize: 14,
  sendKeys: [],
  queueKeys: [],
  shellCompletion: true,
  syntaxExtension: [],
  onChange: vi.fn(),
  onSend: vi.fn(() => true),
  onQueue: vi.fn(() => true),
  onClose: vi.fn(),
};

describe("terminal composer editor extensions", () => {
  it("installs syntax highlighting for loaded language modes", () => {
    expect(composerHighlightStyle.style([t.keyword])).toBeTruthy();
    expect(composerHighlightStyle.style([t.heading2])).toBeTruthy();
  });

  it("uses composer-specific token colors instead of UI theme colors", () => {
    const styleValues = composerHighlightStyle.specs.flatMap((spec) =>
      Object.entries(spec)
        .filter(([key]) => key !== "tag")
        .map(([, value]) => String(value)),
    );

    expect(styleValues).toContain("var(--composer-syntax-keyword)");
    expect(styleValues.some((value) => value.includes("var(--primary)"))).toBe(
      false,
    );
    expect(styleValues.some((value) => value.includes("var(--chart-"))).toBe(
      false,
    );
    expect(styleValues).not.toContain("underline");
  });

  it("enables bracket closing in the editor state", () => {
    const state = createComposerEditorState(baseOptions);

    expect(insertBracket(state, "(")).not.toBeNull();
  });
});
