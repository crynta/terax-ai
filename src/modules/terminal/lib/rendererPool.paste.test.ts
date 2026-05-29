import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("terminal paste shortcut handling", () => {
  it("lets the webview native paste event handle Ctrl+Shift+V", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./rendererPool.ts", import.meta.url)),
      "utf8",
    );

    expect(source).not.toContain("navigator.clipboard.readText");
    expect(source).not.toContain("isTerminalPaste(event)");
  });
});
