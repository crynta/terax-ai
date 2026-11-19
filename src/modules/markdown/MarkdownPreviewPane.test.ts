import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToString } from "react-dom/server";
import { Streamdown } from "streamdown";
import { describe, expect, it, vi } from "vitest";

vi.mock("./useMarkdownDocument", () => ({
  useMarkdownDocument: () => ({
    kind: "ready",
    content:
      "![pic](./img.png)\n\n![embed](data:image/png;base64,AAAA)\n\n[link](https://example.com/page)\n\n[doc](other.md)",
  }),
}));

vi.mock("@/lib/useAssetGrant", () => ({
  useAssetGrant: () => ({
    urlFor: () => "asset://localhost/%2Fw%2Fdocs%2Fimg.png?token=grant123",
    error: null,
    retry: () => {},
    token: "grant123",
  }),
}));

import {
  MarkdownPreviewPane,
  buildPreviewRehypePlugins,
} from "./MarkdownPreviewPane";

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

  it("wires local image rewriting and hardening into preview plugins", () => {
    expect(src).toMatch(/rehypeLocalImages\(/);
    expect(src).toMatch(/rehypeAllowBareRelativeLinks\(/);
    expect(src).toMatch(/rehypeRestoreDocHrefs\(/);
    expect(src).toMatch(/allowedLinkPrefixes:\s*\["\*"\]/);
    expect(src).toMatch(/allowedImagePrefixes:\s*\["\*"\]/);
    expect(src).toMatch(/allowDataImages:\s*true/);
    expect(src).toMatch(/allowedProtocols:\s*\["\*"\]/);
    expect(src.indexOf("rehypeLocalImages(")).toBeLessThan(
      src.indexOf("rehypeAllowBareRelativeLinks("),
    );
    expect(src.indexOf("rehypeAllowBareRelativeLinks(")).toBeLessThan(
      src.indexOf("allowedLinkPrefixes"),
    );
    expect(src.indexOf("allowedLinkPrefixes")).toBeLessThan(
      src.indexOf("rehypeRestoreDocHrefs("),
    );
  });

  it("renders preview with mocked grant and uses the granted image src", () => {
    const html = renderToString(
      React.createElement(MarkdownPreviewPane, {
        path: "/w/docs/readme.md",
        workspaceRoot: "/w",
        visible: true,
        onSetView: () => {},
      }),
    );

    expect(html).toContain(
      'src="asset://localhost/%2Fw%2Fdocs%2Fimg.png?token=grant123"',
    );
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).not.toContain("src=\"data:,\"");
    expect(html).not.toContain("[blocked]");
    expect(html).not.toContain("Blocked URL");
    expect(html).toContain("https://example.com/page");
    expect(html).toContain("./other.md");
  });

  it("renders links, granted local images, and embedded data images through preview plugins", () => {
    const basePath = "/w/docs/readme.md";
    const boundary = "/w";
    const markdown =
      "![pic](./img.png)\n\n![embed](data:image/png;base64,AAAA)\n\n[link](https://example.com/page)\n\n[doc](other.md)";
    const granted = "asset://localhost/%2Fw%2Fdocs%2Fimg.png?token=grant123";

    const renderWithPlugins = (rehypePlugins: unknown[], children = markdown) =>
      renderToString(
        React.createElement(Streamdown, {
          mode: "static",
          parseIncompleteMarkdown: false,
          components: {
            a: (props: any) => React.createElement("a", props, props.children),
            img: (props: any) => React.createElement("img", props),
          },
          rehypePlugins: rehypePlugins as any,
          children,
        }),
      );

    const plugins = buildPreviewRehypePlugins({
      path: basePath,
      boundary,
      assetUrlFor: () => granted,
      token: "grant123",
    });
    const html = renderWithPlugins(plugins);

    expect(html).toContain(`src="${granted}"`);
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('href="https://example.com/page"');
    expect(html).toContain('href="./other.md"');
    expect(html).not.toContain("[blocked]");
    expect(html).not.toContain("Blocked URL");

    const withoutProtocols = plugins.map((plugin: unknown) => {
      if (!Array.isArray(plugin)) return plugin;
      const [fn, opts] = plugin as [any, Record<string, unknown>];
      if (opts && "allowedProtocols" in opts) {
        const { allowedProtocols: _omit, ...rest } = opts as any;
        return [fn, rest];
      }
      return plugin;
    });
    const blocked = renderWithPlugins(withoutProtocols, "![pic](./img.png)");
    expect(blocked).not.toContain(granted);
  });
});
