import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createAllowedElement, renderDocxContent } from "./DocxPreview";

describe("DOCX HTML rendering", () => {
  it("renders a successful empty conversion as an empty document", () => {
    expect(renderToStaticMarkup(createElement(() => renderDocxContent("")))).toContain(
      "This document is empty.",
    );
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
