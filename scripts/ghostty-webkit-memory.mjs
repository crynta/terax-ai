// Measures whether closing terminals returns memory to the operating system in
// a real WKWebView (macOS only). Opens OPEN heavy terminals through the shipped
// loader, closes CLOSE of them, then closes the rest, sampling the WebContent
// process's physical footprint (what Activity Monitor reports) while the page is
// idle. RSS is not used: macOS keeps freed pages in it until memory pressure.
//
//   node scripts/ghostty-webkit-memory.mjs
//   TERAX_WEBKIT_RECLAIM=0 node scripts/ghostty-webkit-memory.mjs   # no collection hint
//
// Environment: TERAX_WEBKIT_ARTIFACT (ghostty-vt.wasm), TERAX_WEBKIT_OPEN (20),
// TERAX_WEBKIT_CLOSE (15), TERAX_WEBKIT_RECLAIM (1), TERAX_WEBKIT_REPORT (json path).
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";

if (process.platform !== "darwin") {
  console.error("ghostty-webkit-memory.mjs needs macOS (WKWebView and footprint)");
  process.exit(2);
}

const artifact = process.env.TERAX_WEBKIT_ARTIFACT ?? "ghostty-vt.wasm";
const open = Number(process.env.TERAX_WEBKIT_OPEN ?? 20);
const close = Number(process.env.TERAX_WEBKIT_CLOSE ?? 15);
const reclaim = process.env.TERAX_WEBKIT_RECLAIM !== "0";
const temporary = await mkdtemp(join(tmpdir(), "terax-webkit-memory-"));

function footprintMegabytes(pid) {
  const output = spawnSync("footprint", [String(pid)], { encoding: "utf8" }).stdout;
  const match = /Footprint:\s+([\d.]+)\s*(KB|MB|GB)/.exec(output);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2] === "KB" ? value / 1024 : match[2] === "GB" ? value * 1024 : value;
}

const phases = [];
let child;
try {
  const bundle = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      assetsInlineLimit: 0,
      lib: { entry: resolve("scripts/ghostty-webkit-memory/entry.ts"), formats: ["iife"], name: "probe" },
    },
  });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle).output.find((chunk) => chunk.type === "chunk");
  const wasm = await readFile(resolve("packages/ghostty-core/adapted", artifact));
  await writeFile(
    join(temporary, "page.html"),
    `<!doctype html><meta charset="utf-8"><script>const WASM_BASE64="${wasm.toString("base64")}";const OPEN=${open};const CLOSE=${close};const RECLAIM=${reclaim};</script><script>${output.code}</script>`,
  );
  const compiled = spawnSync(
    "swiftc",
    ["-O", resolve("scripts/ghostty-webkit-memory/host.swift"), "-o", join(temporary, "host")],
    { encoding: "utf8" },
  );
  if (compiled.status !== 0) throw new Error(`swiftc failed: ${compiled.stderr}`);

  child = spawn(join(temporary, "host"), [join(temporary, "page.html")], { stdio: ["ignore", "pipe", "inherit"] });
  let buffered = "";
  const lines = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      lines.push(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
    }
  });
  const exited = new Promise((resolveExit) => child.on("exit", resolveExit));
  const deadline = Date.now() + 120_000;
  let done = false;
  while (!done && Date.now() < deadline) {
    const line = lines.shift();
    if (line === undefined) {
      await new Promise((tick) => setTimeout(tick, 50));
      continue;
    }
    const pid = Number(/pid=(\d+)$/.exec(line)?.[1] ?? 0);
    const text = line.replace(/ pid=\d+$/, "");
    if (text.startsWith("PHASE") && pid) {
      await new Promise((tick) => setTimeout(tick, 1000));
      const footprint = footprintMegabytes(pid);
      phases.push({ phase: text.slice(6), footprintMegabytes: footprint });
      console.info(`${text.padEnd(70)} footprint ${footprint} MB`);
    } else {
      console.info(text);
      if (text.startsWith("ERROR")) throw new Error(text);
    }
    done = text.startsWith("DONE");
  }
  if (!done) throw new Error("WKWebView host did not finish");
  await Promise.race([exited, new Promise((tick) => setTimeout(tick, 5000))]);
  const report = { artifact, open, close, reclaim, recordedAt: new Date().toISOString(), phases };
  if (process.env.TERAX_WEBKIT_REPORT) await writeFile(process.env.TERAX_WEBKIT_REPORT, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  child?.kill();
  await rm(temporary, { recursive: true, force: true });
}
