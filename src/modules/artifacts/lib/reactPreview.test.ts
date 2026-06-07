import { describe, expect, it, vi } from "vitest";
import { loadReactPreviewDocument } from "@/modules/artifacts/lib/reactPreview";

const source =
  'export default function Card() { return <section className="hero">Hello</section>; }';

describe("React artifact preview loading", () => {
  it("compiles React artifact source through the provided compiler", async () => {
    const compileReact = vi.fn(async () => ({
      document: "<!doctype html><main>Hello</main>",
      diagnostics: [
        {
          code: "ARTIFACT_REACT_INFO",
          severity: "info" as const,
          message: "Compiled with mini runtime",
          line: null,
          column: null,
          endLine: null,
          endColumn: null,
          excerpt: null,
        },
      ],
    }));

    const result = await loadReactPreviewDocument(
      source,
      "preview-1",
      compileReact,
    );

    expect(compileReact).toHaveBeenCalledWith(source, "preview-1");
    expect(result).toEqual({
      status: "ready",
      document: "<!doctype html><main>Hello</main>",
      diagnostics: [
        {
          code: "ARTIFACT_REACT_INFO",
          severity: "info",
          message: "Compiled with mini runtime",
          line: null,
          column: null,
          endLine: null,
          endColumn: null,
          excerpt: null,
        },
      ],
    });
  });

  it("normalizes compiler failures into structured diagnostics", async () => {
    const result = await loadReactPreviewDocument(source, null, async () => {
      throw {
        code: "ARTIFACT_COMPILE_FAILED",
        message: "unexpected closing JSX tag at line 3, column 12",
        diagnostics: [
          {
            code: "ARTIFACT_REACT_JSX_PARSE",
            severity: "error",
            message: "unexpected closing JSX tag",
            line: 3,
            column: 12,
            endLine: 3,
            endColumn: 12,
            excerpt: "return <section></div>;",
          },
        ],
      };
    });

    expect(result).toEqual({
      status: "error",
      diagnostics: [
        {
          code: "ARTIFACT_REACT_JSX_PARSE",
          severity: "error",
          message: "unexpected closing JSX tag",
          line: 3,
          column: 12,
          endLine: 3,
          endColumn: 12,
          excerpt: "return <section></div>;",
        },
      ],
    });
  });
});
