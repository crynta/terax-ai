import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MediaPreview } from "./MediaPreview";

describe.each(["video", "audio"] as const)("%s preview", (kind) => {
  it.each([false, true])("renders native controls with active=%s", (active) => {
    const html = renderToStaticMarkup(
      createElement(MediaPreview, {
        kind,
        src: "asset://localhost/preview",
        active,
      }),
    );
    expect(html).toContain(`<${kind}`);
    expect(html).toContain('controls=""');
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('src="asset://localhost/preview"');
    expect(html.includes(" hidden")).toBe(!active);
    expect(html).not.toContain("autoplay");
  });
});
