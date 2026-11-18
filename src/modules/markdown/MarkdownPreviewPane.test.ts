import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./useMarkdownDocument", () => ({
  useMarkdownDocument: () => ({
    kind: "ready",
    content:
      "![pic](./img.png)\n\n[link](https://example.com/page)\n\n[doc](other.md)",
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
      "src=\"asset://localhost/%2Fw%2Fdocs%2Fimg.png?token=grant123\"",
    );
    expect(html).not.toContain("data:,");
    expect(html).not.toContain("[blocked]");
    expect(html).not.toContain("Blocked URL");
    expect(html).toContain("https://example.com/page");
    expect(html).toContain("./other.md");
  });

  it("keeps links and granted image URLs against preview plugin options", () => {
    const basePath = "/w/docs/readme.md";
    const boundary = "/w";
    const httpGranted =
      "http://asset.localhost/%2Fw%2Fdocs%2Fimg.png?token=grant123";
    const macGranted =
      "asset://localhost/%2Fw%2Fdocs%2Fimg.png?token=grant123";

    const run = (plugins: unknown[]) => {
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
              {
                type: "element",
                tagName: "a",
                properties: { href: "other.md" },
                children: [{ type: "text", value: "doc" }],
              },
            ],
          },
        ],
      } as any;

      for (const plugin of plugins) {
        if (typeof plugin === "function") {
          (plugin as any)()(tree);
        } else if (Array.isArray(plugin)) {
          const [fn, opts] = plugin as [any, any];
          fn(opts)(tree);
        }
      }

      const paragraph = tree.children[0];
      return {
        href: paragraph.children[0].properties.href as string,
        src: paragraph.children[1].properties.src as string,
        relHref: paragraph.children[2].properties.href as string,
        relTitle: paragraph.children[2].properties.title as string | undefined,
      };
    };

    const previewPlugins = buildPreviewRehypePlugins({
      path: basePath,
      boundary,
      assetUrlFor: () => httpGranted,
      token: "grant123",
    });
    const hardenEntry = (previewPlugins as any[]).find(
      (p) => Array.isArray(p) && p[1]?.allowedLinkPrefixes,
    );
    expect(hardenEntry?.[1]).toMatchObject({
      allowedLinkPrefixes: ["*"],
      allowedImagePrefixes: ["*"],
      allowDataImages: true,
      allowedProtocols: ["*"],
    });

    const http = run(previewPlugins);
    expect(http.href).toBe("https://example.com/page");
    expect(http.src).toBe(httpGranted);
    expect(http.relTitle).toBeUndefined();
    expect(http.relHref).toBe("./other.md");

    const macPreviewPlugins = buildPreviewRehypePlugins({
      path: basePath,
      boundary,
      assetUrlFor: () => macGranted,
      token: "grant123",
    });
    const mac = run(macPreviewPlugins);
    expect(mac.src).toBe(macGranted);

    const macWithoutProtocols = (macPreviewPlugins as any[]).map((plugin) => {
      if (!Array.isArray(plugin)) return plugin;
      const [fn, opts] = plugin as [any, Record<string, unknown>];
      if (opts && "allowedProtocols" in opts) {
        const { allowedProtocols: _omit, ...rest } = opts as any;
        return [fn, rest];
      }
      return plugin;
    });
    const macBlocked = run(macWithoutProtocols);
    expect(macBlocked.src).not.toBe(macGranted);
  });
});
