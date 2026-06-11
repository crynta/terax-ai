#!/usr/bin/env node
/**
 * Bundle-size budget gate.
 *
 * Terax targets a featherweight footprint. This sums the gzipped size of the
 * built JS assets and fails if it exceeds the budget, so a heavy dependency or
 * an accidental import can't silently inflate the bundle. Run after `pnpm build`.
 *
 * To raise the budget intentionally, edit BUDGET_BYTES below in the same PR that
 * adds the weight, so the increase is reviewed.
 */
import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUDGET_BYTES = 2_100_000; // gzipped JS; current baseline ~1.82 MB (2026-06-11)

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const assetsDir = resolve(repoRoot, "dist/assets");

async function main() {
  let entries;
  try {
    entries = await readdir(assetsDir);
  } catch {
    console.error(
      `Bundle-size check: ${assetsDir} not found. Run \`pnpm build\` first.`,
    );
    process.exit(1);
  }

  const jsFiles = entries.filter((name) => name.endsWith(".js"));
  if (jsFiles.length === 0) {
    console.error("Bundle-size check: no JS assets found in dist/assets.");
    process.exit(1);
  }

  let total = 0;
  const sizes = [];
  for (const name of jsFiles) {
    const contents = await readFile(resolve(assetsDir, name));
    const gz = gzipSync(contents).length;
    total += gz;
    sizes.push([name, gz]);
  }

  const fmt = (n) => `${(n / 1024).toFixed(1)} KB`;
  sizes.sort((a, b) => b[1] - a[1]);
  console.log(`Bundle-size check: ${jsFiles.length} JS chunks, gzipped`);
  for (const [name, gz] of sizes.slice(0, 5)) {
    console.log(`  ${fmt(gz).padStart(10)}  ${name}`);
  }
  console.log(`  total: ${fmt(total)} (budget ${fmt(BUDGET_BYTES)})`);

  if (total > BUDGET_BYTES) {
    console.error(
      `Bundle-size check FAILED: ${fmt(total)} exceeds budget ${fmt(BUDGET_BYTES)}.`,
    );
    process.exit(1);
  }
  console.log("Bundle-size check passed");
}

main().catch((error) => {
  console.error(`Bundle-size check error: ${error}`);
  process.exit(1);
});
