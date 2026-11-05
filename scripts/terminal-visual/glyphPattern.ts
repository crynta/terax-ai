/*
 * Patterns for `pattern=colors`, `pattern=icons` and `pattern=cursor`, and the cell
 * positions their pixel checks (`glyphCheck.ts`) look at. Every pattern starts on row
 * 0 after a screen clear, so a case's `row` and `col` are cell coordinates in the
 * capture. The patterns are plain ANSI, so both renderers draw them from the same model.
 */

export type Rgb = readonly [number, number, number];

export type ColorCase = {
  readonly label: string;
  readonly row: number;
  readonly col: number;
  readonly expected: Rgb;
};

export type IconCase = {
  readonly label: string;
  readonly row: number;
  readonly col: number;
  /** Cells the glyph occupies. */
  readonly span: number;
  /**
   * `icon`: may overflow into the blank cell after it, never left or beyond two cells.
   * `stretch`: fills its cell box exactly. `wide`: CJK and emoji, within their cells.
   */
  readonly kind: "icon" | "stretch" | "wide";
};

const ESC = "\x1b[";

const CUBE = [0, 95, 135, 175, 215, 255] as const;

/** The xterm 256-colour palette entry for indexes 16 and up. */
export function xterm256(index: number): Rgb {
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    return [level, level, level];
  }
  const n = index - 16;
  return [CUBE[Math.floor(n / 36)], CUBE[Math.floor(n / 6) % 6], CUBE[n % 6]];
}

const INDEXED = [196, 46, 21, 226, 201, 51, 208, 93, 244, 250, 160, 34];
const TRUECOLOR: readonly Rgb[] = [
  [255, 120, 0],
  [0, 200, 255],
  [180, 60, 220],
  [30, 220, 90],
  [250, 250, 60],
  [255, 60, 120],
];

/** ANSI 16, indexed 256 and truecolor foregrounds: `M` samples, two cells apart. */
export function colorsPattern(palette: readonly Rgb[]): {
  readonly ansi: string;
  readonly cases: ColorCase[];
} {
  const cases: ColorCase[] = [];
  const rows: string[] = [];
  let line = "";
  for (let i = 0; i < 16; i += 1) {
    line += `${ESC}${i < 8 ? 30 + i : 90 + i - 8}mM${ESC}0m `;
    cases.push({ label: `ansi ${i}`, row: 0, col: i * 2, expected: palette[i] });
  }
  rows.push(line);
  line = "";
  INDEXED.forEach((index, k) => {
    line += `${ESC}38;5;${index}mM${ESC}0m `;
    cases.push({ label: `256 ${index}`, row: 1, col: k * 2, expected: xterm256(index) });
  });
  rows.push(line);
  line = "";
  TRUECOLOR.forEach((color, k) => {
    line += `${ESC}38;2;${color.join(";")}mM${ESC}0m `;
    cases.push({ label: `rgb ${color.join(",")}`, row: 2, col: k * 2, expected: color });
  });
  rows.push(line);
  line = "";
  for (let i = 1; i < 7; i += 1) {
    line += `${ESC}1;3${i}mM${ESC}0m `;
    cases.push({ label: `bold ${i}`, row: 3, col: (i - 1) * 2, expected: palette[i] });
  }
  rows.push(line);
  return { ansi: rows.join("\r\n"), cases };
}

const PRIVATE_USE: ReadonlyArray<readonly [string, string]> = [
  ["powerline branch U+E0A0", "\ue0a0"],
  ["devicon node U+E718", "\ue718"],
  ["codicon U+EB99", "\ueb99"],
  ["font awesome folder U+F07B", "\uf07b"],
  ["material design folder U+F024B", "\u{f024b}"],
];
// The bundled face has no U+E0C9 or U+E0CB.
const POWERLINE_EXTRA: ReadonlyArray<readonly [string, string]> = [
  0xe0c0, 0xe0c1, 0xe0c2, 0xe0c3, 0xe0c4, 0xe0c5, 0xe0c6, 0xe0c7, 0xe0c8, 0xe0ca, 0xe0cc, 0xe0cd,
].map((codepoint) => [
  `powerline extra U+${codepoint.toString(16).toUpperCase()}`,
  String.fromCodePoint(codepoint),
]);
const POWERLINE_SEPARATORS: ReadonlyArray<readonly [string, string]> = [
  ["trapezoid half U+E0D6", "\ue0d6"],
  ["trapezoid half U+E0D7", "\ue0d7"],
];
const WIDE: ReadonlyArray<readonly [string, string]> = [
  ["cjk U+65E5", "日"],
  ["cjk U+672C", "本"],
  ["hangul", "한"],
];
const EMOJI: ReadonlyArray<readonly [string, string]> = [
  ["emoji grin", "😀"],
  ["emoji rocket", "🚀"],
  ["zwj family", "👨‍👩‍👧"],
  ["flag", "🇯🇵"],
  ["skin tone", "👍🏽"],
];

/** Icons, CJK and emoji, each followed by blank cells so overflow shows. */
export function iconsPattern(): { readonly ansi: string; readonly cases: IconCase[] } {
  const cases: IconCase[] = [];
  const rows: string[] = [];
  const row = (
    items: ReadonlyArray<readonly [string, string]>,
    rowIndex: number,
    span: number,
    kind: IconCase["kind"],
  ) => {
    // The model gives a private-use character one cell whatever the glyph's width; a wide
    // character takes two. Every item starts four cells after the previous one.
    const cells = kind === "wide" ? 2 : 1;
    let line = "";
    items.forEach(([label, text], k) => {
      line += text + " ".repeat(4 - cells);
      cases.push({ label, row: rowIndex, col: k * 4, span, kind });
    });
    rows.push(line);
  };
  row(PRIVATE_USE, 0, 1, "icon");
  rows.push("");
  row(WIDE, 2, 2, "wide");
  rows.push("");
  row(EMOJI, 4, 2, "wide");
  rows.push("");
  row(POWERLINE_EXTRA, 6, 2, "stretch");
  rows.push("");
  row(POWERLINE_SEPARATORS, 8, 1, "stretch");
  return { ansi: rows.join("\r\n"), cases };
}

export const CURSOR_TEXT_LINES = [
  'git commit -m "fix cursor"',
  "",
  "日本語 wide 한국어",
  "",
  `${ESC}31mred${ESC}0m ${ESC}1;32mbold green${ESC}0m ${ESC}38;2;255;120;0mtruecolor${ESC}0m`,
];

/** Text to put a cursor on: a plain letter, a wide character and coloured text. */
export function cursorPattern(): string {
  return CURSOR_TEXT_LINES.join("\r\n");
}

export type CursorTarget = { readonly row: number; readonly col: number };

/** The cells the cursor harness parks on, in the order the README lists them. */
export const CURSOR_TARGETS = {
  letter: { row: 0, col: 4 },
  wide: { row: 2, col: 0 },
  colored: { row: 4, col: 0 },
} as const satisfies Record<string, CursorTarget>;
