import { readFile } from "node:fs/promises";
import {
  TeraxGhostty,
  type TeraxGhosttyRenderState,
  type TeraxGhosttyTerminal,
} from "@terax/ghostty-core/adapted";
import { afterAll, beforeAll, bench, describe } from "vitest";

const artifacts = ["ghostty-vt.wasm", "ghostty-vt-scalar.wasm"];
const terminals: TeraxGhosttyTerminal[] = [];
const streamingUpdate = new TextEncoder().encode(
  Array.from(
    { length: 1_024 },
    (_, index) =>
      `\r\x1b[2Kagent ${index}: analyzing repository and streaming tokens`,
  ).join(""),
);
const incrementalUpdates = [
  new TextEncoder().encode("\x1b[10;1Hagent frame A"),
  new TextEncoder().encode("\x1b[10;1Hagent frame B"),
];

// An Ink-style dynamic region: every tick erases and rewrites the same twelve
// lines, and only the spinner glyph on the first line changes.
const INK_LINES = 12;
const INK_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const inkErase = `${"\x1b[2K\x1b[1A".repeat(INK_LINES)}\x1b[2K\x1b[G`;
const inkTicks = INK_SPINNER.map((spinner) => {
  const lines = [
    `\x1b[1;36m${spinner}\x1b[0m \x1b[1mWorking\x1b[0m \x1b[2m(12s · esc to interrupt)\x1b[0m`,
    "",
    "\x1b[32m●\x1b[0m Read(\x1b[4msrc/modules/terminal/ghostty/AdaptedGhostty.bench.ts\x1b[0m)",
    "  \x1b[2m⎿ Read 214 lines\x1b[0m",
    "\x1b[32m●\x1b[0m Update(packages/ghostty-core/adapted/wasm/src/terax.zig)",
    "  \x1b[2m⎿ Updated with 118 additions and 12 removals\x1b[0m",
    "     \x1b[31m- const old = 1;\x1b[0m",
    "     \x1b[32m+ const next = 2; // 日本語のコメント\x1b[0m",
    "",
    "\x1b[38;5;240m╭──────────────────────────────────────────────────────────────────────╮\x1b[0m",
    "\x1b[38;5;240m│\x1b[0m > \x1b[7m \x1b[0m                                                                  \x1b[38;5;240m│\x1b[0m",
    "\x1b[38;5;240m╰──────────────────────────────────────────────────────────────────────╯\x1b[0m",
  ];
  return new TextEncoder().encode(
    inkErase + lines.map((line) => `\x1b[2K${line}\r\n`).join(""),
  );
});

type InkTerminals = {
  readonly parseOnly: TeraxGhosttyTerminal;
  readonly soa: TeraxGhosttyTerminal;
  readonly gpu: TeraxGhosttyTerminal;
  readonly scrollSoa: TeraxGhosttyTerminal;
  readonly scrollGpu: TeraxGhosttyTerminal;
};
// A streaming log: one new line per tick scrolls the whole viewport.
const scrollLines = Array.from({ length: 64 }, (_, line) =>
  new TextEncoder().encode(
    `\x1b[32m${line}\x1b[0m agent output: analyzing repository and streaming tokens ${line * 7919}\r\n`,
  ),
);
let scrollTick = 0;
const inkTerminals: InkTerminals[] = [];
let inkTick = 0;

/**
 * What the v1 WebGPU surface does per dirty row: ~12 accessor reads per cell
 * and a 64-byte instance written for every cell, blank or not.
 */
const packScratch = new Uint32Array(16);
function packLikeBuildRows(state: TeraxGhosttyRenderState): number {
  let checksum = 0;
  const { cols } = state;
  for (let row = 0; row < state.rows; row += 1) {
    if (!state.dirtyRows[row]) continue;
    for (let column = 0; column < cols; column += 1) {
      const index = row * cols + column;
      if (state.widths[index] === 2 || state.widths[index] === 3) continue;
      const flags = state.styleFlags[index];
      const offset = index * 4;
      let foreground =
        (state.foregroundRgba[offset] << 16) |
        (state.foregroundRgba[offset + 1] << 8) |
        state.foregroundRgba[offset + 2];
      let background =
        (state.backgroundRgba[offset] << 16) |
        (state.backgroundRgba[offset + 1] << 8) |
        state.backgroundRgba[offset + 2];
      if (flags & (1 << 4)) [foreground, background] = [background, foreground];
      const underline =
        (state.underlineRgba[offset] << 16) |
        (state.underlineRgba[offset + 1] << 8) |
        state.underlineRgba[offset + 2];
      const codepoint = state.codepoints[index];
      packScratch[0] = column * 9;
      packScratch[1] = row * 18;
      packScratch[2] = background;
      packScratch[3] = underline;
      packScratch[4] = foreground;
      packScratch[5] = flags | (state.underlineStyles[index] << 8);
      packScratch[6] = codepoint;
      packScratch[7] = state.graphemeLengths[index];
      checksum += packScratch[2] ^ packScratch[6];
    }
  }
  return checksum;
}

beforeAll(async () => {
  for (const artifact of artifacts) {
    const bytes = await readFile(
      new URL(
        `../../../../packages/ghostty-core/adapted/${artifact}`,
        import.meta.url,
      ),
    );
    const ghostty = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
    terminals.push(
      ghostty.createTerminal(120, 40, {
        maxScrollbackBytes: 8 * 1024 * 1024,
        maxScrollbackLines: 10_000,
      }),
    );
    const options = {
      maxScrollbackBytes: 8 * 1024 * 1024,
      maxScrollbackLines: 10_000,
    };
    const ink: InkTerminals = {
      parseOnly: ghostty.createTerminal(120, 40, options),
      soa: ghostty.createTerminal(120, 40, options),
      gpu: ghostty.createTerminal(120, 40, options),
      scrollSoa: ghostty.createTerminal(120, 40, options),
      scrollGpu: ghostty.createTerminal(120, 40, options),
    };
    ink.gpu.setRenderFormat("gpu");
    ink.scrollGpu.setRenderFormat("gpu");
    for (const terminal of [ink.scrollSoa, ink.scrollGpu]) {
      for (const line of scrollLines) terminal.write(line);
    }
    ink.scrollSoa.updateRenderState();
    ink.scrollGpu.updateGpuRenderState();
    ink.scrollGpu.acknowledgeGpuGlyphs();
    for (const terminal of [ink.parseOnly, ink.soa, ink.gpu]) {
      terminal.write(inkTicks[0]);
    }
    ink.soa.updateRenderState();
    ink.gpu.updateGpuRenderState();
    ink.gpu.acknowledgeGpuGlyphs();
    inkTerminals.push(ink);
  }
});

afterAll(() => {
  for (const terminal of terminals) terminal.dispose();
  for (const ink of inkTerminals) {
    ink.parseOnly.dispose();
    ink.soa.dispose();
    ink.gpu.dispose();
    ink.scrollSoa.dispose();
    ink.scrollGpu.dispose();
  }
});

for (const [index, artifact] of artifacts.entries()) {
  describe(artifact, () => {
    let incrementalIndex = 0;
    bench("parse a bounded streaming update", () => {
      terminals[index].write(streamingUpdate);
    });
    bench("synchronize one changed agent row", () => {
      incrementalIndex ^= 1;
      terminals[index].write(incrementalUpdates[incrementalIndex]);
      terminals[index].updateRenderState();
    });
    bench("synchronize an unchanged visible state", () => {
      terminals[index].updateRenderState();
    });
  });

  // One bench iteration is one Ink tick: erase + rewrite 12 lines, one spinner
  // glyph differs. "consumer" adds what the v1 renderer does with the result.
  describe(`${artifact} Ink-like 12-line region, one spinner character changing per tick`, () => {
    bench("parse only (shared baseline)", () => {
      inkTick = (inkTick + 1) % inkTicks.length;
      inkTerminals[index].parseOnly.write(inkTicks[inkTick]);
    });
    bench("SoA format: write + update", () => {
      inkTick = (inkTick + 1) % inkTicks.length;
      inkTerminals[index].soa.write(inkTicks[inkTick]);
      inkTerminals[index].soa.updateRenderState();
    });
    bench("SoA format: write + update + JS cell packing (v1 consumer)", () => {
      inkTick = (inkTick + 1) % inkTicks.length;
      inkTerminals[index].soa.write(inkTicks[inkTick]);
      packLikeBuildRows(inkTerminals[index].soa.updateRenderState());
    });
    bench(
      "GPU format: write + update (exact dirty rows, no JS cell work)",
      () => {
        inkTick = (inkTick + 1) % inkTicks.length;
        const terminal = inkTerminals[index].gpu;
        terminal.write(inkTicks[inkTick]);
        const state = terminal.updateGpuRenderState();
        for (const _glyph of state.newGlyphs) void _glyph;
        terminal.acknowledgeGpuGlyphs();
      },
    );
    bench("GPU format: identical redraw (no row changes)", () => {
      const terminal = inkTerminals[index].gpu;
      terminal.write(inkTicks[0]);
      terminal.updateGpuRenderState();
    });
  });

  // Every tick appends a line, so every visible row changes.
  describe(`${artifact} streaming log, full viewport scroll per tick`, () => {
    bench("SoA format: write + update", () => {
      scrollTick = (scrollTick + 1) % scrollLines.length;
      inkTerminals[index].scrollSoa.write(scrollLines[scrollTick]);
      inkTerminals[index].scrollSoa.updateRenderState();
    });
    bench("GPU format: write + update", () => {
      scrollTick = (scrollTick + 1) % scrollLines.length;
      const terminal = inkTerminals[index].scrollGpu;
      terminal.write(scrollLines[scrollTick]);
      terminal.updateGpuRenderState();
      terminal.acknowledgeGpuGlyphs();
    });
  });
}
