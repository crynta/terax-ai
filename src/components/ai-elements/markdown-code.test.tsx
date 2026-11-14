import { describe, expect, it } from "vitest";

import { MarkdownCode, markdownCodeText } from "./markdown-code";

describe("markdownCodeText", () => {
  it("preserves text nested inside React children for HTML-wrapped code blocks", async () => {
    const React = await import("react");

    const text = markdownCodeText([
      "\n",
      React.createElement("span", { key: "a" }, 'const client = createClient("");'),
      "\n",
      React.createElement("span", { key: "b" }, 'await client.send({ id: "example" });'),
      "\n",
    ]);

    expect(text).toBe(
      '\nconst client = createClient("");\nawait client.send({ id: "example" });\n',
    );
  });
});

describe("MarkdownCode", () => {
  const render = async (props: Record<string, unknown>) => {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    return renderToStaticMarkup(React.createElement(MarkdownCode, props));
  };

  it("renders a fence without a language as a block, keeping its lines", async () => {
    const tree = "src/\n  app.ts\n  lib/  utils.ts\n";
    const html = await render({ "data-block": "true", node: {}, children: tree });
    expect(html).toContain("<pre");
    expect(html).toContain("  lib/  utils.ts");
    expect(html).not.toContain("data-block");
  });

  it("keeps inline code inline", async () => {
    const html = await render({ children: "pnpm test" });
    expect(html).toMatch(/^<code/);
  });
});
