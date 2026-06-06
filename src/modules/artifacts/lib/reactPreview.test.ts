import { describe, expect, it, vi } from "vitest";
import { loadReactPreviewDocument } from "@/modules/artifacts/lib/reactPreview";

const source =
  'export default function Card() { return <section className="hero">Hello</section>; }';

describe("React artifact preview loading", () => {
  it("compiles React artifact source through the provided compiler", async () => {
    const compileReact = vi.fn(async () => ({
      document: "<!doctype html><main>Hello</main>",
      diagnostics: [],
    }));

    const result = await loadReactPreviewDocument(source, compileReact);

    expect(compileReact).toHaveBeenCalledWith(source);
    expect(result).toEqual({
      status: "ready",
      document: "<!doctype html><main>Hello</main>",
      diagnostics: [],
    });
  });

  it("normalizes compiler failures into diagnostics", async () => {
    const result = await loadReactPreviewDocument(source, async () => {
      throw { message: "Import is not allowlisted" };
    });

    expect(result).toEqual({
      status: "error",
      diagnostics: ["Import is not allowlisted"],
    });
  });
});
