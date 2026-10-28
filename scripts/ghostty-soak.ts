import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { afterAll, expect, it } from "vitest";
import {
  fillStackCanary,
  peakStackBytes,
  readWasmLayout,
  runStackWorkloads,
} from "../src/modules/terminal/ghostty/wasmStackProbe";

const reports: unknown[] = [];
const stackReports: unknown[] = [];
const blockTracking = process.env.TERAX_SOAK_BLOCKS === "1";
// TERAX_SOAK_FORMAT=gpu exercises the GPU cell-record format instead of the
// structure-of-arrays format (the default).
const gpuFormat = process.env.TERAX_SOAK_FORMAT === "gpu";
const epochs = 64;
const updatesPerEpoch = 2_048;
const fixtures = Array.from({ length: 256 }, (_, index) => new TextEncoder().encode(
  `${blockTracking && index % 32 === 0 ? "\x1b]133;C;agent batch\x07" : ""}\x1b[38;5;${index}magent ${index} λ 日本語 🙂 \x1b]8;;https://example.test/source/${index}\x1b\\source\x1b]8;;\x1b\\\x1b[0m\r\n${blockTracking && index % 32 === 31 ? "\x1b]133;D;0\x07" : ""}`,
));

const artifacts = process.env.TERAX_SOAK_ARTIFACT
  ? [process.env.TERAX_SOAK_ARTIFACT]
  : ["ghostty-vt.wasm", "ghostty-vt-scalar.wasm"];
for (const artifact of artifacts) {
  it(`${artifact}: five models plateau under streaming, reflow, and presentation recycling`, async () => {
    const bytes = await readFile(resolve(process.env.TERAX_SOAK_CORE_DIR ?? "packages/ghostty-core/adapted", artifact));
    const core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
    const models = Array.from({ length: 5 }, () => core.createTerminal(120, 40, {
      maxScrollbackBytes: 8 * 1024 * 1024,
      maxScrollbackLines: 10_000,
    }));
    if (blockTracking) for (const model of models) model.enableSemanticMarkers(true);
    if (gpuFormat) for (const model of models) model.setRenderFormat("gpu");
    const refresh = (model: (typeof models)[number]) => {
      if (!gpuFormat) return model.updateRenderState();
      const state = model.updateGpuRenderState();
      model.acknowledgeGpuGlyphs();
      return state;
    };
    const samples: { epoch: number; wasmBytes: number; nodeRssBytes: number }[] = [];
    const started = performance.now();
    const cpu = process.cpuUsage();
    let inputBytes = 0;
    try {
      for (let epoch = 0; epoch < epochs; epoch++) {
        for (let update = 0; update < updatesPerEpoch; update++) {
          const fixture = fixtures[update % fixtures.length];
          for (let index = 0; index < models.length; index++) {
            models[index].write(fixture);
            if (blockTracking) models[index].drainEvents();
            inputBytes += fixture.byteLength;
            if (index < 3) refresh(models[index]);
          }
        }
        models[1].releaseRenderState();
        refresh(models[3]);
        models[3].releaseRenderState();
        models[4].resize(epoch % 2 ? 120 : 160, epoch % 2 ? 40 : 50);
        refresh(models[4]);
        models[4].compactRenderState();
        samples.push({ epoch, wasmBytes: core.getMemoryBytes(), nodeRssBytes: process.memoryUsage().rss });
      }
      const tail = samples.slice(-16).map((sample) => sample.wasmBytes);
      const plateauGrowth = Math.max(...tail) - Math.min(...tail);
      const report = {
        artifact, sha256: createHash("sha256").update(bytes).digest("hex"), blockTracking, renderFormat: gpuFormat ? "gpu" : "soa", markerCounts: models.map((model) => model.semanticMarkerCount()), models: models.length, updates: epochs * updatesPerEpoch * models.length,
        inputBytes, elapsedMs: performance.now() - started, cpuMicroseconds: process.cpuUsage(cpu),
        finalWasmBytes: core.getMemoryBytes(), plateauGrowthBytes: plateauGrowth,
        resources: models.map((model) => model.resourceStats()), samples,
      };
      reports.push(report);
      console.info(JSON.stringify({ artifact, inputBytes, elapsedMs: report.elapsedMs, finalWasmBytes: report.finalWasmBytes, plateauGrowthBytes: plateauGrowth }));
      expect(models[0].resourceStats().renderStateResets).toBeGreaterThan(0);
      expect(plateauGrowth).toBeLessThanOrEqual(64 * 1024);
    } finally {
      for (const model of models) model.dispose();
    }
  });
}

for (const artifact of artifacts) {
  it(`${artifact}: adversarial input and deep nesting stay within half of the WebAssembly stack`, async () => {
    const bytes = await readFile(resolve(process.env.TERAX_SOAK_CORE_DIR ?? "packages/ghostty-core/adapted", artifact));
    const layout = readWasmLayout(bytes);
    const core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
    const instance = core.instantiate();
    fillStackCanary(instance.exports.memory, layout.stackTop);
    const terminal = instance.createTerminal(120, 40, {
      maxScrollbackBytes: 8 * 1024 * 1024,
      maxScrollbackLines: 10_000,
    });
    try {
      const started = performance.now();
      const workload = runStackWorkloads(terminal, gpuFormat ? "gpu" : "soa");
      const peak = peakStackBytes(instance.exports.memory, layout.stackTop);
      const report = { artifact, renderFormat: gpuFormat ? "gpu" : "soa", stackBytes: layout.stackTop, initialMemoryBytes: layout.initialPages * 65536, peakStackBytes: peak, peakStackFraction: peak / layout.stackTop, ...workload, elapsedMs: performance.now() - started, memoryBytes: instance.memoryBytes };
      stackReports.push(report);
      console.info(JSON.stringify(report));
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThanOrEqual(layout.stackTop / 2);
    } finally {
      terminal.dispose();
      instance.dispose();
    }
  });
}

afterAll(async () => {
  const path = process.env.TERAX_SOAK_REPORT;
  if (path) await writeFile(path, `${JSON.stringify({
    scope: "Node WASM core only; excludes Tauri IPC, WebKit, GPU, and application energy",
    recordedAt: new Date().toISOString(), node: process.version, platform: process.platform,
    arch: process.arch, reports, stackReports,
  }, null, 2)}\n`);
});
