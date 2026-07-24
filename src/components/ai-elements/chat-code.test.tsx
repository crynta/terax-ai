import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatCodeBlock } from "./chat-code";

describe("ChatCodeBlock run action default", () => {
  // Chat renders without a CodeRunActionProvider and relies on the context
  // defaulting to true; a silent default flip would strip chat's
  // run-in-terminal button. The preview opts out explicitly (locked in
  // RenderedMarkdown.test.tsx).
  it("renders the run-in-terminal button without a provider", () => {
    const html = renderToStaticMarkup(<ChatCodeBlock code="ls -la" lang="bash" />);
    expect(html).toContain('aria-label="Run in active terminal"');
    expect(html).toContain('aria-label="Copy code"');
  });
});
