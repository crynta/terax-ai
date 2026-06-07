import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelComparePanel } from "./index";

describe("ModelComparePanel lazy export", () => {
  it("renders a stable fallback through the public module export", () => {
    const html = renderToStaticMarkup(<ModelComparePanel />);

    expect(html).toContain("Loading model compare…");
    expect(html).toContain(
      "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card/80",
    );
  });
});
