import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultRehypePlugins } from "streamdown";
import { rehypeLocalImages } from "./lib/assetPath";

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
    expect(src).toMatch(/allowedProtocols:\s*\["\*"\]/);
    expect(src.indexOf("rehypeLocalImages(")).toBeLessThan(
      src.indexOf("allowedLinkPrefixes"),
    );
  });

  it("keeps an https link and a production-shaped granted local image URL", () => {
    const basePath = "/w/docs/readme.md";
    const boundary = "/w";
    const grantedUrl =
      "http://asset.localhost/%2Fw%2Fdocs%2Fimg.png?token=grant123";
    const policy = { boundary, isReadable: () => true };

    const tree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          children: [
            {
              type: "element",
              tagName: "a",
              properties: { href: "https://example.com/page" },
              children: [{ type: "text", value: "link" }],
            },
            {
              type: "element",
              tagName: "img",
              properties: { src: "./img.png", alt: "pic" },
              children: [],
            },
          ],
        },
      ],
    };

    rehypeLocalImages(
      basePath,
      () => grantedUrl,
      policy,
      `${basePath}\0${boundary}\0grant123`,
    )()(tree);
    const [hardenFn, hardenDefaults] = defaultRehypePlugins.harden as [
      (opts: Record<string, unknown>) => (tree: unknown) => void,
      Record<string, unknown>,
    ];
    hardenFn({
      ...hardenDefaults,
      allowedLinkPrefixes: ["*"],
      allowedImagePrefixes: ["*"],
      allowDataImages: true,
      allowedProtocols: ["*"],
    })(tree);

    const paragraph = (tree as any).children[0];
    const link = paragraph.children[0];
    const image = paragraph.children[1];

    expect(link.properties.href).toBe("https://example.com/page");
    expect(image.properties.src).toBe(grantedUrl);
  });
});
