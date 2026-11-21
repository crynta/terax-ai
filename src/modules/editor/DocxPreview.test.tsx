import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createAllowedElement,
  getDocxPreviewLimitError,
  MAX_DOCX_HTML_LENGTH,
  renderDocxContent,
} from "./DocxPreview";

describe("DOCX HTML rendering", () => {
  it("rejects converted content above the preview limit", () => {
    expect(
      getDocxPreviewLimitError("x".repeat(MAX_DOCX_HTML_LENGTH)),
    ).toBeNull();
    expect(
      getDocxPreviewLimitError("x".repeat(MAX_DOCX_HTML_LENGTH + 1)),
    ).toContain("preview is limited");
  });

  it("shows a limit notice without parsing oversized HTML", () => {
    const html = "<p>x</p>".repeat(Math.ceil((MAX_DOCX_HTML_LENGTH + 1) / 8));
    expect(
      renderToStaticMarkup(createElement(() => renderDocxContent(html))),
    ).toContain("DOCX preview is limited");
  });

  it("renders a successful empty conversion as an empty document", () => {
    expect(
      renderToStaticMarkup(createElement(() => renderDocxContent(""))),
    ).toContain("This document is empty.");
  });

  it.each(["br", "hr"] as const)(
    "renders <%s> without passing children",
    (tag) => {
      const element = createAllowedElement(
        tag,
        "void-element",
        [],
        {} as Element,
      );

      expect(renderToStaticMarkup(createElement(() => element))).toBe(
        tag === "br" ? "<br/>" : "<hr/>",
      );
    },
  );
});
