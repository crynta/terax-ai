import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source contract for #304: the connect-provider banner must expose a dismiss
 * path. Without onClose + the dismiss button, panelOpen && !hasComposer left
 * users stuck - StatusBar only offers panel-close controls when hasComposer
 * is true.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "AiInputBar.tsx"), "utf8");

describe("AiInputBarConnect dismiss (#304)", () => {
  it("accepts an onClose prop", () => {
    expect(src).toMatch(/onClose\?: \(\) => void/);
  });

  it("renders a Close control wired to onClose", () => {
    expect(src).toMatch(/aria-label="Close"/);
    expect(src).toMatch(/onClick=\{onClose\}/);
    expect(src).toMatch(/Cancel01Icon/);
  });

  it("dismisses on Escape when onClose is provided", () => {
    expect(src).toMatch(/e\.key !== "Escape"/);
    expect(src).toMatch(/window\.addEventListener\("keydown"/);
  });
});
