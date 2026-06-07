import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PiChatPanel } from "@/modules/pi/PiChatPanel";

describe("PiChatPanel", () => {
  it("renders a real Chat surface with isolated Pi state", () => {
    const html = renderToStaticMarkup(<PiChatPanel />);

    expect(html).toContain('aria-label="Chat sessions"');
    expect(html).toContain(
      "relative flex h-full min-h-0 min-w-0 overflow-hidden bg-card/80",
    );
    expect(html).toContain('class="min-h-0 min-w-0 flex-1 overflow-hidden"');
    expect(html).toContain("Chat");
    expect(html).not.toContain("Conversation workspace is coming soon");
  });
});
