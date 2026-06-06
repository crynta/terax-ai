import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PiSection } from "@/modules/pi/components/PiSection";

describe("PiSection", () => {
  it("renders content and expanded state when open", () => {
    const html = renderToStaticMarkup(
      <PiSection
        title="Diagnostics"
        collapsed={false}
        onCollapsedChange={() => {}}
      >
        <div>Diagnostic body</div>
      </PiSection>,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Diagnostic body");
  });

  it("keeps only the header visible when collapsed", () => {
    const html = renderToStaticMarkup(
      <PiSection title="Context" collapsed onCollapsedChange={() => {}}>
        <div>Context body</div>
      </PiSection>,
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Context");
    expect(html).not.toContain("Context body");
  });
});
