import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PiChatPanel } from "@/modules/pi/PiChatPanel";

describe("PiChatPanel", () => {
  it("renders a real Chat surface with isolated Pi state", () => {
    const html = renderToStaticMarkup(<PiChatPanel />);

    expect(html).toContain('aria-label="Chat sessions"');
    expect(html).toContain("Chat");
    expect(html).not.toContain("Conversation workspace is coming soon");
  });
});
