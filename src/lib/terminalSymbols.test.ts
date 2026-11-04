import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

const FACES = [
  {
    file: "terax-terminal-symbols.woff2",
    family: "Terax Terminal Symbols",
    range: "U+E000-F8FF",
    sha256: "08107a419bbbc0d24ea11fdbae136bc7fa1943a0fc2b3495975a8b3082428081",
    // The face every terminal loads: small enough to be part of first paint.
    maxBytes: 400_000,
  },
  {
    file: "terax-terminal-symbols-mdi.woff2",
    family: "Terax Terminal Symbols MDI",
    range: "U+F0000-FFFFD",
    sha256: "987533dfb02fd9f769dc199ffbf5f2bea02b9a102883eaa795fbebfacc10f4ac",
    maxBytes: 400_000,
  },
];

it.each(FACES)("ships the verified, bounded $family face", async (face) => {
  const bytes = await readFile(
    new URL(`../assets/fonts/${face.file}`, import.meta.url),
  );
  expect(bytes.subarray(0, 4).toString()).toBe("wOF2");
  expect(bytes.byteLength).toBeLessThanOrEqual(face.maxBytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(face.sha256);
});

it("ships the font licenses", async () => {
  const license = await readFile(
    new URL("../../public/licenses/terminal-symbols.txt", import.meta.url),
    "utf8",
  );
  expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
  expect(license).toContain("JetBrains Mono Project Authors");
});

it.each(FACES)(
  "limits $family to its private-use range and fetches it only on use",
  async (face) => {
    const stylesheet = await readFile(
      new URL("../styles/fonts.css", import.meta.url),
      "utf8",
    );
    const rule = stylesheet
      .match(/@font-face\s*\{[^}]*\}/g)
      ?.find((block) => block.includes(`font-family: '${face.family}';`));
    expect(rule).toContain(`unicode-range: ${face.range};`);
    expect(rule).toContain(face.file);
  },
);
