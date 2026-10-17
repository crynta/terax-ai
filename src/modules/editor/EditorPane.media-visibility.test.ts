import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "EditorPane.tsx"), "utf8");

describe("EditorPane media visibility", () => {
  it("hides video element when not visible", () => {
    expect(src).toMatch(/className=\{cn\("max-w-full max-h-full", !visible && "hidden"\)\}/);
    expect(src).toMatch(/ref=\{mediaRef as React\.RefObject<HTMLVideoElement>\}/);
  });

  it("hides audio element when not visible", () => {
    expect(src).toMatch(/className=\{cn\("w-full max-w-md", !visible && "hidden"\)\}/);
    expect(src).toMatch(/ref=\{mediaRef as React\.RefObject<HTMLAudioElement>\}/);
  });

  it("accepts visible prop", () => {
    expect(src).toMatch(/visible\?: boolean/);
    expect(src).toMatch(/visible\s*=\s*true/);
  });
});
