import { streamdownPlugins } from "@/components/ai-elements/streamdown-plugins";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Streamdown } from "streamdown";

describe("streamdownPlugins", () => {
  it("renders inline and block math as KaTeX markup", () => {
    const html = renderToStaticMarkup(
      <Streamdown mode="static" plugins={streamdownPlugins}>
        {"Inline $x^2$ and block:\n\n$$\nx^2\n$$"}
      </Streamdown>,
    );

    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
  });
});
