/*
 * The `pattern=sprites` test pattern: borders, tables, progress bars, spinners
 * and a powerline prompt, written as colour runs so the same description feeds
 * the terminal (as truecolor SGR) and `spriteCheck.mjs` (which rebuilds the
 * expected frame cell by cell from the procedural glyph generator and compares
 * it with the captured pixels).
 */

export type Rgb = readonly [number, number, number];

export type SpriteRun = {
  readonly text: string;
  readonly fg?: Rgb;
  readonly bg?: Rgb;
  readonly bold?: boolean;
  readonly italic?: boolean;
};

export type SpriteRow = readonly SpriteRun[];

/** Matches the harness theme in `main.ts`. */
export const DEFAULT_FOREGROUND: Rgb = [0xd0, 0xd4, 0xd9];
export const DEFAULT_BACKGROUND: Rgb = [0x16, 0x18, 0x1b];

const BLUE: Rgb = [0x61, 0xaf, 0xef];
const GREEN: Rgb = [0x6f, 0xc3, 0x6f];
const YELLOW: Rgb = [0xe5, 0xc0, 0x7b];
const RED: Rgb = [0xe0, 0x55, 0x55];
const MAGENTA: Rgb = [0xc6, 0x78, 0xdd];
const CYAN: Rgb = [0x56, 0xb6, 0xc2];
const GRAY: Rgb = [0x5c, 0x63, 0x70];
const WHITE: Rgb = [0xff, 0xff, 0xff];
const INK: Rgb = [0x1b, 0x1d, 0x1f];

const cp = (...codepoints: number[]) => String.fromCodePoint(...codepoints);
const run = (text: string, fg?: Rgb, bg?: Rgb, extra = {}): SpriteRun => ({
  text,
  fg,
  bg,
  ...extra,
});
const plain = (text: string): SpriteRow => [run(text)];

type BorderSet = readonly [string, string, string, string, string, string];
const LIGHT: BorderSet = ["┌", "─", "┐", "│", "└", "┘"];
const HEAVY: BorderSet = ["┏", "━", "┓", "┃", "┗", "┛"];
const DOUBLE: BorderSet = ["╔", "═", "╗", "║", "╚", "╝"];
const ROUND: BorderSet = ["╭", "─", "╮", "│", "╰", "╯"];

/** Concentric boxes, one cell of padding between borders. */
function nestedBoxes(
  sets: readonly BorderSet[],
  colors: readonly Rgb[],
  label: string,
): SpriteRow[] {
  const layers = sets.length;
  const width = layers * 4 + label.length;
  const height = layers * 2 + 1;
  const rows: SpriteRow[] = [];
  for (let y = 0; y < height; y += 1) {
    const runs: SpriteRun[] = [];
    for (let x = 0; x < width; x += 1) {
      // The outermost layer whose border passes through (x, y), if any.
      let char = " ";
      let color: Rgb | undefined;
      for (let layer = 0; layer < layers; layer += 1) {
        const left = layer * 2;
        const right = width - 1 - layer * 2;
        // One row of vertical inset per layer, two columns horizontally.
        const top = layer;
        const bottom = height - 1 - layer;
        if (x < left || x > right || y < top || y > bottom) continue;
        const [tl, h, tr, v, bl, br] = sets[layer];
        const onLeft = x === left;
        const onRight = x === right;
        const onTop = y === top;
        const onBottom = y === bottom;
        if (!(onLeft || onRight || onTop || onBottom)) continue;
        char =
          onTop && onLeft
            ? tl
            : onTop && onRight
              ? tr
              : onBottom && onLeft
                ? bl
                : onBottom && onRight
                  ? br
                  : onTop || onBottom
                    ? h
                    : v;
        color = colors[layer];
        break;
      }
      runs.push(run(char, color));
    }
    rows.push(runs);
  }
  const middle = rows[layers].slice();
  const start = Math.floor((width - label.length) / 2);
  rows[layers] = [
    ...middle.slice(0, start),
    run(label, WHITE),
    ...middle.slice(start + label.length),
  ];
  return rows;
}

function sideBySide(
  left: readonly SpriteRow[],
  right: readonly SpriteRow[],
  gap: number,
): SpriteRow[] {
  const rows = Math.max(left.length, right.length);
  const leftWidth = Math.max(
    ...left.map((row) => row.reduce((n, r) => n + [...r.text].length, 0)),
  );
  const out: SpriteRow[] = [];
  for (let y = 0; y < rows; y += 1) {
    const l = left[y] ?? [];
    const used = l.reduce((n, r) => n + [...r.text].length, 0);
    out.push([...l, run(" ".repeat(leftWidth - used + gap)), ...(right[y] ?? [])]);
  }
  return out;
}

function table(): SpriteRow[] {
  const lines = [
    "┏━━━━━━━━━━┯━━━━━━━━━━┯━━━━━━━━━┓",
    "┃ Task     │ Status   │ Time    ┃",
    "┣━━━━━━━━━━┿━━━━━━━━━━┿━━━━━━━━━┫",
    "┃ lint     │ passed   │ 1.2s    ┃",
    "┠──────────┼──────────┼─────────┨",
    "┃ test     ╎ FAILED   ┆ 14.8s   ┃",
    "┡━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━┩",
    "│ build    │ running  │ ...     │",
    "╞══════════╪══════════╪═════════╡",
    "│ deploy   │ queued   │         │",
    "├──────────┼──────────┼─────────┤",
    "│ docs     │ skipped  │ 0.0s    │",
    "└──────────┴──────────┴─────────┘",
  ];
  const width = [...lines[0]].length;
  for (const line of lines) {
    if ([...line].length !== width) throw new Error(`ragged table row: ${line}`);
  }
  return lines.map((line) => [
    run(line, BLUE),
  ]);
}

function inputBox(): SpriteRow[] {
  const width = 54;
  return [
    [run(`╭${"─".repeat(width - 2)}╮`, GRAY)],
    [
      run("│", GRAY),
      run(" > ", MAGENTA),
      run(`Try "refactor the renderer"${" ".repeat(width - 2 - 3 - 27)}`),
      run("│", GRAY),
    ],
    [run(`╰${"─".repeat(width - 2)}╯`, GRAY)],
    [run("  ? for shortcuts", GRAY)],
  ];
}

function powerline(): SpriteRow[] {
  const segment = (text: string, bg: Rgb, fg: Rgb): SpriteRun =>
    run(text, fg, bg);
  const sep = (char: string, from: Rgb, to: Rgb): SpriteRun =>
    run(char, from, to);
  const a = BLUE;
  const b: Rgb = [0x3b, 0x82, 0xc4];
  const c: Rgb = [0x2e, 0x7d, 0x32];
  const d: Rgb = [0xd1, 0x86, 0x16];
  const arrow = cp(0xe0b0);
  const thin = cp(0xe0b1);
  const left = cp(0xe0b2);
  const leftThin = cp(0xe0b3);
  const roundRight = cp(0xe0b4);
  const roundLeft = cp(0xe0b6);
  return [
    [
      segment(" user ", a, INK),
      sep(arrow, a, b),
      segment(" ~/Dev/Terax ", b, WHITE),
      sep(arrow, b, c),
      segment(" main ", c, WHITE),
      sep(arrow, c, d),
      segment(" 3 ", d, INK),
      sep(arrow, d, DEFAULT_BACKGROUND),
      run(" "),
      run(thin, GRAY),
      run(" ok ", GRAY),
      run(thin, GRAY),
      run(" "),
      run(leftThin, GRAY),
      run(left, d),
      segment(" 12:04 ", d, INK),
    ],
    [
      run(roundLeft, a),
      segment(" pill ", a, INK),
      run(roundRight, a),
      run(" "),
      run(roundLeft, c),
      segment(" ok ", c, WHITE),
      run(roundRight, c),
      run(" "),
      run(cp(0xe0b8, 0xe0b9, 0xe0ba, 0xe0bb), YELLOW),
      run(cp(0xe0bc, 0xe0bd, 0xe0be, 0xe0bf), CYAN),
      run(" "),
      run(cp(0xe0b5), RED),
      run(cp(0xe0b7), RED),
    ],
  ];
}

export function spriteRows(): SpriteRow[] {
  const rows: SpriteRow[] = [];
  rows.push(plain("Procedural glyphs: borders, tables, bars, braille, powerline"));
  rows.push(plain(""));
  rows.push(
    ...sideBySide(
      nestedBoxes(
        [LIGHT, HEAVY, DOUBLE, ROUND],
        [BLUE, GREEN, YELLOW, MAGENTA],
        "nested",
      ),
      table(),
      3,
    ),
  );
  rows.push(plain(""));
  rows.push(...inputBox());
  rows.push(plain(""));
  rows.push([
    run("building   "),
    run("[", GRAY),
    run("█████████████▍", GREEN),
    run("░░░░░░░░░░░░░░░", GRAY),
    run("]", GRAY),
    run(" 47%"),
    run("   tests ", undefined),
    run("▕", GRAY),
    run("████████████████████████▌", CYAN),
    run("▏", GRAY),
    run(" 78%"),
  ]);
  rows.push([
    run("spark      "),
    run("▁▂▃▄▅▆▇█▇▆▅▄▃▂▁ ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁", YELLOW),
    run("  "),
    run("▏▎▍▌▋▊▉█ █▉▊▋▌▍▎▏", GREEN),
    run("  "),
    run("▀▔ ▕▐ ▄", RED),
  ]);
  rows.push([
    run("shades     "),
    run("░░░░▒▒▒▒▓▓▓▓████▓▓▓▓▒▒▒▒░░░░", BLUE),
    run("  "),
    run("░▒▓", WHITE, [0x2e, 0x7d, 0x32]),
    run("░▒▓", INK, [0xe5, 0xc0, 0x7b]),
    run("  quads "),
    run("▖▗▘▙▚▛▜▝▞▟", MAGENTA),
    run("  "),
    run("◢◣◤◥", RED),
    run(" "),
    run("╱╲╳", CYAN),
  ]);
  const spinner = [..."⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"].join(" ");
  const heavy = [..."⣾⣽⣻⢿⡿⣟⣯⣷"].join(" ");
  rows.push([
    run("braille    "),
    run(spinner, YELLOW),
    run("   "),
    run(heavy, GREEN),
    run("   "),
    run("⢀⣠⣴⣾⣿⣷⣦⣄⡀ ⣿⣿⣿⡿⠿⠛⠉", CYAN),
  ]);
  rows.push([
    run("dashes     "),
    run("┄┅┆┇┈┉┊┋ ╌╍╎╏ ", BLUE),
    run("╴╵╶╷╸╹╺╻ ╼╽╾╿ ", GREEN),
    run(
      "▀▀▀▀▀▀▀▀▄▄▄▄▄▄▄▄",
      [0x44, 0x88, 0xcc],
      [0xcc, 0x66, 0x44],
    ),
  ]);
  rows.push([
    run("sextants   "),
    run(
      cp(0x1fb00, 0x1fb01, 0x1fb02, 0x1fb03, 0x1fb07, 0x1fb0f, 0x1fb1e, 0x1fb3b),
      YELLOW,
    ),
    run("  mosaics "),
    run(cp(0x1fb3c, 0x1fb41, 0x1fb52, 0x1fb57, 0x1fb62, 0x1fb67), GREEN),
    run("  bars "),
    run(cp(0x1fb70, 0x1fb71, 0x1fb76, 0x1fb77, 0x1fb82, 0x1fb87), CYAN),
    run("  circles "),
    run(cp(0x1fbe0, 0x1fbe1, 0x1fbe2, 0x1fbe3, 0x1fbe8, 0x1fbec), MAGENTA),
  ]);
  rows.push(plain(""));
  rows.push(...powerline());
  rows.push(plain(""));
  // The same borders in bold and italic: the glyphs must not change.
  rows.push([
    run("┌──┬──┐ ╔══╦══╗ ╭──╮ ", BLUE),
    run("┌──┬──┐ ╔══╦══╗ ╭──╮ ", BLUE, undefined, { bold: true }),
    run("┌──┬──┐ ╔══╦══╗ ╭──╮ ", BLUE, undefined, { italic: true }),
    run("┌──┬──┐ ╔══╦══╗ ╭──╮", BLUE, undefined, { bold: true, italic: true }),
  ]);
  rows.push([
    run("├──┼──┤ ╠══╬══╣ │  │ ", BLUE),
    run("├──┼──┤ ╠══╬══╣ │  │ ", BLUE, undefined, { bold: true }),
    run("├──┼──┤ ╠══╬══╣ │  │ ", BLUE, undefined, { italic: true }),
    run("├──┼──┤ ╠══╬══╣ │  │", BLUE, undefined, { bold: true, italic: true }),
  ]);
  rows.push([
    run("└──┴──┘ ╚══╩══╝ ╰──╯ ", BLUE),
    run("└──┴──┘ ╚══╩══╝ ╰──╯ ", BLUE, undefined, { bold: true }),
    run("└──┴──┘ ╚══╩══╝ ╰──╯ ", BLUE, undefined, { italic: true }),
    run("└──┴──┘ ╚══╩══╝ ╰──╯", BLUE, undefined, { bold: true, italic: true }),
  ]);
  // Double verticals with light rules, and the other way round.
  rows.push([
    run("╓──╥──╖ ╒══╤══╕ ╔══╗ ╭──╮ ┏━━┓", MAGENTA),
  ]);
  rows.push([
    run("╟──╫──╢ ╞══╪══╡ ║  ║ │  │ ┃  ┃", MAGENTA),
  ]);
  rows.push([
    run("╙──╨──╜ ╘══╧══╛ ╚══╝ ╰──╯ ┗━━┛", MAGENTA),
  ]);
  return rows;
}

const rgb = (kind: 38 | 48, color: Rgb) =>
  `\x1b[${kind};2;${color[0]};${color[1]};${color[2]}m`;

/** The rows as terminal output (CRLF separated, colours as truecolor SGR). */
export function spriteAnsi(rows: readonly SpriteRow[] = spriteRows()): string {
  return rows
    .map((row) =>
      row
        .map((item) => {
          const style =
            (item.fg ? rgb(38, item.fg) : "") +
            (item.bg ? rgb(48, item.bg) : "") +
            (item.bold ? "\x1b[1m" : "") +
            (item.italic ? "\x1b[3m" : "");
          return style ? `${style}${item.text}\x1b[0m` : item.text;
        })
        .join(""),
    )
    .join("\r\n");
}
