import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "MarkdownPreviewPane.tsx"), "utf8");
const streamdownMatch = src.match(/<Streamdown[\s\S]*?<\/Streamdown>/);
const streamdownJsx = streamdownMatch?.[0] ?? "";

describe("MarkdownPreviewPane Streamdown configuration", () => {
  it("renders complete markdown files in static mode", () => {
    expect(streamdownJsx).toMatch(/mode="static"/);
  });

  it("does not run streaming incomplete-markdown repair for files", () => {
    expect(streamdownJsx).toMatch(/parseIncompleteMarkdown=\{false\}/);
  });

  it("passes explicit rehype-harden options for links and images", () => {
    expect(src).toMatch(/allowedLinkPrefixes:\s*\["\*"\]/);
    expect(src).toMatch(/allowedImagePrefixes:\s*\["\*"\]/);
    expect(src).toMatch(/allowDataImages:\s*true/);
    expect(src.indexOf("rehypeLocalImages(")).toBeLessThan(
      src.indexOf("allowedLinkPrefixes"),
    );
  });
});
