import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "AiInputBar.tsx",
);

function textareaClassSource(): string {
  const source = readFileSync(sourcePath, "utf8");
  const textareaStart = source.indexOf("<textarea");
  expect(textareaStart).toBeGreaterThanOrEqual(0);
  const classStart = source.indexOf("className={cn(", textareaStart);
  expect(classStart).toBeGreaterThanOrEqual(0);
  const classEnd = source.indexOf(")}", classStart);
  expect(classEnd).toBeGreaterThan(classStart);
  return source.slice(classStart, classEnd);
}

describe("AiInputBar IME composition layout", () => {
  it("allows the composer textarea to shrink inside its flex row", () => {
    expect(textareaClassSource()).toContain("min-w-0");
  });
});
