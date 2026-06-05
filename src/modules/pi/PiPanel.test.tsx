import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PiPanel } from "@/modules/pi/PiPanel";

describe("PiPanel", () => {
  it("keeps all secondary sections collapsed by default", () => {
    const html = renderToStaticMarkup(<PiPanel />);

    expect(html).toContain("Local CLI agents");
    expect(html).toContain("Diagnostics");
    expect(html).toContain("Context");
    expect(html).toContain("Sessions");
    expect(html).not.toContain("No hidden spawns");
  });

  it("offers a header control for showing only the active chat", () => {
    const html = renderToStaticMarkup(<PiPanel />);

    expect(html).toContain('aria-label="Show only Code chat"');
    expect(html).toContain('aria-pressed="false"');
  });
});
