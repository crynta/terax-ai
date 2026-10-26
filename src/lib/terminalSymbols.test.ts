import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("ships the verified, bounded symbol font and its license", async () => {
  const bytes = await readFile(
    new URL("../assets/fonts/terax-terminal-symbols.woff2", import.meta.url),
  );
  expect(bytes.subarray(0, 4).toString()).toBe("wOF2");
  expect(bytes.byteLength).toBeLessThanOrEqual(800_000);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "8018ddbbb42236f39b011df985e1cae09b26a477e9549850b3ee914c31b90e4b",
  );
  const license = await readFile(
    new URL("../../public/licenses/terminal-symbols.txt", import.meta.url),
    "utf8",
  );
  expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
  expect(license).toContain("JetBrains Mono Project Authors");
});

it("limits the bundled face to private-use symbols", async () => {
  const stylesheet = await readFile(
    new URL("../styles/fonts.css", import.meta.url),
    "utf8",
  );
  const face = stylesheet.match(
    /@font-face\s*\{[^}]*font-family: 'Terax Terminal Symbols';[^}]*\}/s,
  )?.[0];
  expect(face).toContain("unicode-range: U+E000-F8FF, U+F0000-FFFFD;");
  expect(face).toContain("terax-terminal-symbols.woff2");
});
