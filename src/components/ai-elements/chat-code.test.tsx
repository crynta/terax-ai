import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatCodeBlock } from "./chat-code";

describe("ChatCodeBlock run action default", () => {
  // Chat relies on the context default staying true; a silent flip would
  // strip its run-in-terminal button.
  it("renders the run-in-terminal button without a provider", () => {
    const html = renderToStaticMarkup(<ChatCodeBlock code="ls -la" lang="bash" />);
    expect(html).toContain('aria-label="Run in active terminal"');
    expect(html).toContain('aria-label="Copy code"');
  });
});
