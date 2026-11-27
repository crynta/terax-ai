import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToString } from "react-dom/server";
import { Streamdown, type StreamdownProps } from "streamdown";
import { describe, expect, it, vi } from "vitest";

vi.mock("./useMarkdownDocument", () => ({
  useMarkdownDocument: () => ({
    kind: "ready",
    content:
      "![pic](./img.png)\n\n![embed](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCioAAAAASUVORK5CYII=)\n\n[link](https://example.com/page)\n\n[doc](other.md)",
  }),
}));

vi.mock("@/lib/useAssetGrant", () => ({
  useAssetGrant: () => ({
    urlFor: () => "asset://localhost/%2Fw%2Fdocs%2Fimg.png?token=grant123",
    error: null,
    retry: () => {},
  }),
}));

import {
  buildPreviewRehypePlugins,
  MarkdownPreviewPane,
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
    expect(html).toContain(
      'src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCioAAAAASUVORK5CYII="',
    );
    expect(html).not.toContain('src="data:,"');
    expect(html).not.toContain("[blocked]");
    expect(html).not.toContain("Blocked URL");
    expect(html).toContain("https://example.com/page");
    expect(html).toContain("./other.md");
  });

  it("renders images, safe links, and unique document anchors through preview plugins", () => {
    const basePath = "/w/docs/readme.md";
    const boundary = "/w";
    const markdown =
      "![pic](./img.png)\n\n![embed](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCioAAAAASUVORK5CYII=)\n\n[link](https://example.com/page)\n\n[doc](other.md)";
    const granted = "asset://localhost/%2Fw%2Fdocs%2Fimg.png?token=grant123";

    const renderWithPlugins = (
      rehypePlugins: StreamdownProps["rehypePlugins"],
      children = markdown,
    ) =>
      renderToString(
        React.createElement(Streamdown, {
          mode: "static",
          parseIncompleteMarkdown: false,
          linkSafety: { enabled: false },
          rehypePlugins,
          children,
        }),
      );

    const plugins = buildPreviewRehypePlugins({
      path: basePath,
      boundary,
      assetUrlFor: () => granted,
    });
    const html = renderWithPlugins(plugins);

    expect(html).toContain(`src="${granted}"`);
    expect(html).toContain(
      'src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCioAAAAASUVORK5CYII="',
    );
    expect(html).toContain('href="https://example.com/page"');
    expect(html).toContain('href="./other.md"');
    expect(html).not.toContain("[blocked]");
    expect(html).not.toContain("Blocked URL");

    const refreshed = granted
      .replace("asset://", "http://asset.")
      .replace("grant123", "grant456");
    const refreshedHtml = renderWithPlugins(
      buildPreviewRehypePlugins({
        path: basePath,
        boundary,
        assetUrlFor: () => refreshed,
      }),
    );
    expect(refreshedHtml).toContain(`src="${refreshed}"`);
    expect(refreshedHtml).not.toContain("?token=grant123");

    const remote = renderWithPlugins(
      plugins,
      [
        "[Site](//docs.example.com/guide)",
        "![Diagram](//docs.example.com/diagram.png)",
        "[![Vendor logo](https://docs.example.com/logo.png)](https://docs.example.com/)",
      ].join("\n\n"),
    );
    expect(remote).toContain('href="https://docs.example.com/guide"');
    expect(remote).toContain('href="https://docs.example.com/diagram.png"');
    expect(remote).toContain("Open image in browser: Diagram");
    expect(remote).toContain("<span>Vendor logo</span>");
    expect(remote).not.toContain("<img");

    const headings = renderWithPlugins(
      plugins,
      "## Install\n\n## Install\n\n## Install-1\n\n## Quick_start",
    );
    expect(headings).toContain('data-markdown-heading="install"');
    expect(headings).toContain('data-markdown-heading="install-1"');
    expect(headings).toContain('data-markdown-heading="install-1-1"');
    expect(headings).toContain('data-markdown-heading="quick_start"');
  });
});
