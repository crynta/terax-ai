import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PiFloatingWindow } from "@/modules/pi/components/PiFloatingWindow";

describe("PiFloatingWindow", () => {
  it("clips the floating content body", () => {
    const html = renderToStaticMarkup(
      <PiFloatingWindow onClose={() => {}} onOpenWorkspace={() => {}}>
        <div>Code panel</div>
      </PiFloatingWindow>,
    );

    expect(html).toContain("Code panel");
    expect(html).toContain('class="min-h-0 min-w-0 flex-1 overflow-hidden"');
  });
});
