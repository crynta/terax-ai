import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { it } from "vitest";

it("profiles identical isolated core workloads against optional baseline artifacts", async () => {
  const directories = [
    resolve(
      process.env.TERAX_PROFILE_CORE_DIR ?? "packages/ghostty-core/adapted",
    ),
  ];
  const results = [];
  const encode = (value: string) => new TextEncoder().encode(value);
  const workloads = {
    row: [encode("\x1b[10;1Hagent frame A"), encode("\x1b[10;1Hagent frame B")],
    scrolling: [encode("agent output: analyzing repository\r\n")],
    semantic: [encode("\x1b]133;A\x07\x1b]133;B\x07")],
  };
  for (const directory of directories) {
    for (const artifact of [
      process.env.TERAX_PROFILE_ARTIFACT ?? "ghostty-vt.wasm",
    ]) {
      const bytes = await readFile(resolve(directory, artifact));
      const core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
      const models = [];
      const allocations = [{ models: 0, wasmBytes: core.getMemoryBytes() }];
      for (let count = 1; count <= 20; count++) {
        models.push(
          core.createTerminal(120, 40, {
            maxScrollbackBytes: 8 * 1024 * 1024,
            maxScrollbackLines: 10_000,
          }),
        );
        if ([1, 5, 10, 20].includes(count))
          allocations.push({ models: count, wasmBytes: core.getMemoryBytes() });
      }
      for (const model of models) model.dispose();
      const timings: Record<string, number[]> = {};
      for (const [name, fixtures] of Object.entries(workloads)) {
        const samples = [];
        for (let sample = 0; sample < 7; sample++) {
          const model = core.createTerminal(120, 40, {
            maxScrollbackBytes: 8 * 1024 * 1024,
            maxScrollbackLines: 10_000,
          });
          try {
            model.write(encode("initial output\r\n".repeat(40)));
            model.updateRenderState();
            const start = performance.now();
            for (let index = 0; index < 10_000; index++) {
              model.write(fixtures[index % fixtures.length]);
              model.drainEvents();
              model.updateRenderState();
            }
            if (sample > 0) samples.push(performance.now() - start);
          } finally {
            model.dispose();
          }
        }
        timings[name] = samples;
      }
      results.push({
        directory,
        artifact,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        allocations,
        timings,
      });
    }
  }
  const report = {
    scope:
      "Isolated WASM core; excludes IPC, webview, GPU, and application memory or energy",
    recordedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    iterationsPerSample: 10_000,
    warmupSamples: 1,
    results,
  };
  const output = process.env.TERAX_PROFILE_REPORT;
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  else console.info(JSON.stringify(report));
});
