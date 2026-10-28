#!/usr/bin/env node
// Synthetic coding-agent workload for the app lab (scripts/app-lab/run.py).
//
// It runs inside a real PTY and writes what Ink applications such as Claude Code and Codex
// write: a dynamic region of REGION_LINES lines that is erased (cursor-up + erase-line) and
// rewritten on every render, a spinner that advances every --spinner-ms, token text streamed
// at --chars characters every --token-ms, completed lines flushed above the region into
// scrollback, a history of --history lines at start and, now and then, a tool-output block
// with a box-drawing border. The same program is used for every scenario so that runs are
// comparable.
//
//   agent-sim.mjs [--seed N] [--history 300] [--spinner-ms 80] [--token-ms 50] [--chars 40]
//                 [--rows 12] [--block-every-s 7] [--duration S] [--margin 1]   (duration 0 = until killed)

const options = {
  seed: 1,
  history: 300,
  "spinner-ms": 80,
  "token-ms": 50,
  chars: 40,
  rows: 12,
  "block-every-s": 7,
  duration: 0,
  // Columns left unused at the right edge. Ink draws full width (0): narrowing the terminal by
  // one column then wraps every border line; the default of 1 hides that.
  margin: 1,
};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, "");
  if (!(key in options) || process.argv[i + 1] === undefined) {
    console.error(`unknown or incomplete option ${process.argv[i]}`);
    process.exit(2);
  }
  options[key] = Number(process.argv[i + 1]);
}

const SPINNER = ["·", "✢", "✳", "✶", "✻", "✽"];
const WORDS = (
  "the renderer presents damaged rows through a shared atlas while hidden panes keep parsing " +
  "output without allocating presentation buffers and agents keep streaming tokens into scrollback"
).split(" ");
const REGION_LINES = options.rows;
const ESC = "\x1b[";
const ERASE_REGION = `${ESC}2K${ESC}1A`.repeat(REGION_LINES) + `${ESC}2K${ESC}G`;

let seed = (options.seed * 2654435761) >>> 0;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};
const tokens = (chars) => {
  let text = "";
  while (text.length < chars) text += `${WORDS[Math.floor(random() * WORDS.length)]} `;
  return text.slice(0, chars);
};
const clip = (text, width) => {
  const glyphs = Array.from(text);
  return glyphs.length <= width ? text : glyphs.slice(0, width).join("");
};
const dim = (text, width) => `${ESC}90m${clip(text, width)}${ESC}0m`;
const columns = () => Math.max(40, (process.stdout.columns || 100) - options.margin);

const write = (text) => process.stdout.write(text);

function box(width, title, lines) {
  const inner = Math.max(0, width - 2);
  const out = [`${ESC}90m╭─ ${clip(title, inner - 4)} ${"─".repeat(Math.max(0, inner - 4 - Array.from(clip(title, inner - 4)).length))}╮${ESC}0m`];
  for (const line of lines) {
    const text = clip(line, inner - 2);
    out.push(`${ESC}90m│${ESC}0m ${text.padEnd(Math.max(0, inner - 2))} ${ESC}90m│${ESC}0m`);
  }
  out.push(`${ESC}90m╰${"─".repeat(inner)}╯${ESC}0m`);
  return out;
}

let spinner = 0;
let stream = "";
let rendered = false;

function region(width) {
  const lines = [
    dim("─".repeat(width), width),
    `${ESC}38;5;209m${SPINNER[spinner % SPINNER.length]}${ESC}0m ${ESC}38;5;209mThinking…${ESC}0m ${dim("(esc to interrupt · ctrl+t to show todos)", width)}`,
    "",
    `${ESC}38;5;75m●${ESC}0m ${clip(stream, width - 3)}`,
    "",
    `  ${dim("⎿", width)}  ${ESC}32m☒${ESC}0m ${clip("Read renderer sources and window policy", width - 8)}`,
    `     ${ESC}32m☒${ESC}0m ${clip("Add occlusion and agent workloads to the lab", width - 8)}`,
    `     ${ESC}1m☐${ESC}0m ${clip("Capture baseline footprint, CPU and energy", width - 8)}`,
    `     ☐ ${clip("Compare candidate against the baseline report", width - 8)}`,
    dim(`╭${"─".repeat(Math.max(0, width - 2))}╮`, width),
    `${ESC}90m│${ESC}0m > ${clip('Try "fix the failing test"', width - 6).padEnd(Math.max(0, width - 6))} ${ESC}90m│${ESC}0m`,
    dim(`╰${"─".repeat(Math.max(0, width - 2))}╯`, width),
  ];
  // Rows beyond the twelve Ink lines above (--rows) are blank lines inside the region.
  while (lines.length < REGION_LINES) lines.push("");
  return `${lines.slice(0, REGION_LINES).join("\r\n")}\r\n`;
}

function render(token) {
  const width = columns();
  if (token) stream += tokens(options.chars);
  else spinner++;
  let output = rendered ? ERASE_REGION : "";
  if (stream.length >= width - 6) {
    output += `${ESC}38;5;75m●${ESC}0m ${clip(stream, width - 3)}\r\n`;
    stream = "";
  }
  output += region(width);
  rendered = true;
  write(output);
}

function flushBlock() {
  // A tool-output block lands above the dynamic region, like Ink's <Static>.
  const width = columns();
  const lines = [];
  for (let i = 0; i < 6; i++) lines.push(`${(1000 * random()) | 0}: ${tokens(width)}`);
  let output = rendered ? ERASE_REGION : "";
  output += `${box(width, "Bash(pnpm test)", lines).join("\r\n")}\r\n`;
  output += region(width);
  rendered = true;
  write(output);
}

// History: scrollback the user would already have in a long session.
{
  const width = columns();
  let text = `\x1b[2J${ESC}H`;
  for (let line = 0; line < options.history; line++) {
    if (line % 40 === 20) text += `${box(width, `tool call ${line}`, [tokens(width), tokens(width)]).join("\r\n")}\r\n`;
    else text += `${ESC}3${line % 8}m${String(line).padStart(5, "0")}${ESC}0m ${tokens(width - 8)}\r\n`;
  }
  write(text);
}

write(`${ESC}?25l`);
const timers = [];
const every = (ms, fn) => {
  const origin = performance.now();
  let count = 0;
  const tick = () => {
    fn();
    count++;
    timers.push(setTimeout(tick, Math.max(0, origin + count * ms - performance.now())));
  };
  timers.push(setTimeout(tick, ms));
};
every(options["spinner-ms"], () => render(false));
every(options["token-ms"], () => render(true));
if (options["block-every-s"] > 0) every(options["block-every-s"] * 1000, flushBlock);

const stop = () => {
  for (const timer of timers) clearTimeout(timer);
  write(`${ESC}?25h\r\n`);
  process.exit(0);
};
// Ink repaints on the stdout "resize" event; node only refreshes process.stdout.columns (and
// installs its SIGWINCH handler) when something listens for it.
process.stdout.on("resize", () => render(false));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("SIGHUP", stop);
// Ink keeps the process alive on stdin; a closed PTY ends it.
process.stdin.on("end", stop);
process.stdin.resume();
if (options.duration > 0) setTimeout(stop, options.duration * 1000);
