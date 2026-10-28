import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import v8 from "node:v8";
import vm from "node:vm";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { it } from "vitest";
import { readWasmLayout } from "../src/modules/terminal/ghostty/wasmStackProbe";

v8.setFlagsFromString("--expose-gc");
const collectGarbage = vm.runInNewContext("gc") as () => void;
const MEBIBYTE = 1024 * 1024;
const terminalOptions = {
  maxScrollbackBytes: 8 * MEBIBYTE,
  maxScrollbackLines: 10_000,
};

function memory() {
  const usage = process.memoryUsage();
  return {
    rssBytes: usage.rss,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
    heapUsedBytes: usage.heapUsed,
  };
}

// V8 frees a dropped WebAssembly memory in a later garbage collection that
// finishes on the event loop, so one gc() call is not enough.
async function settle(): Promise<void> {
  let previous = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((resolveTick) => setTimeout(resolveTick, 25));
    collectGarbage();
    const external = process.memoryUsage().external;
    if (attempt >= 2 && external >= previous) return;
    previous = external;
  }
}

function percentiles(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  return { samples: sorted.length, medianMs: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
}

function fillHeavy(terminal: ReturnType<TeraxGhostty["createTerminal"]>) {
  const slice = new TextEncoder().encode(`${"scrollback line ".repeat(6)}0123\r\n`.repeat(300));
  for (let lines = 0; lines < 12_000; lines += 300) terminal.write(slice);
  terminal.updateRenderState();
}

// "private" is the shipped design (one instance per terminal); "shared"
// emulates the previous design (every terminal in one instance) with the same
// code so the two can be compared in one process.
async function lifecycle(core: TeraxGhostty, mode: "private" | "shared") {
  const opened = 20;
  const closed = 15;
  await settle();
  const before = { ...memory(), wasmBytes: core.getMemoryBytes() };
  const shared = mode === "shared" ? core.instantiate() : null;
  const terminals: ReturnType<TeraxGhostty["createTerminal"]>[] = [];
  for (let index = 0; index < opened; index++) {
    const terminal = shared
      ? shared.createTerminal(120, 40, terminalOptions)
      : core.createTerminal(120, 40, terminalOptions);
    fillHeavy(terminal);
    terminals.push(terminal);
  }
  const afterOpen = { ...memory(), wasmBytes: core.getMemoryBytes() };
  for (let index = 0; index < closed; index++) terminals.pop()?.dispose();
  const wasmAfterClose = core.getMemoryBytes();
  await settle();
  const afterClose = { ...memory(), wasmBytes: wasmAfterClose };
  while (terminals.length > 0) terminals.pop()?.dispose();
  shared?.dispose();
  await settle();
  const afterCloseAll = { ...memory(), wasmBytes: core.getMemoryBytes() };
  return {
    mode,
    opened,
    closed,
    kept: opened - closed,
    before,
    afterOpen,
    afterClose,
    afterCloseAll,
    externalReturnedByClosingBytes: afterOpen.externalBytes - afterClose.externalBytes,
    rssReturnedByClosingBytes: afterOpen.rssBytes - afterClose.rssBytes,
  };
}

async function instantiationLatency(
  core: TeraxGhostty,
  bytes: Uint8Array,
) {
  const compileStart = performance.now();
  await WebAssembly.compile(Uint8Array.from(bytes).buffer);
  const compileMs = performance.now() - compileStart;
  const instantiate: number[] = [];
  const createTerminal: number[] = [];
  for (let index = 0; index < 220; index++) {
    const start = performance.now();
    const instance = core.instantiate();
    const instantiated = performance.now();
    instance.dispose();
    const terminalStart = performance.now();
    const terminal = core.createTerminal(120, 40, terminalOptions);
    const created = performance.now();
    terminal.dispose();
    if (index >= 20) {
      instantiate.push(instantiated - start);
      createTerminal.push(created - terminalStart);
    }
  }
  return {
    compileMs,
    instantiate: percentiles(instantiate),
    instantiateAndCreateTerminal: percentiles(createTerminal),
  };
}

it("profiles identical isolated core workloads against optional baseline artifacts", async () => {
  const directories = [
    resolve(
      process.env.TERAX_PROFILE_CORE_DIR ?? "packages/ghostty-core/adapted",
    ),
  ];
  const results = [];
  const encode = (value: string) => new TextEncoder().encode(value);
  // TERAX_PROFILE_FORMAT=gpu times the GPU cell-record format instead of SoA.
  const gpuFormat = process.env.TERAX_PROFILE_FORMAT === "gpu";
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
      const layout = readWasmLayout(bytes);
      const core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer, {
        reclaim: null,
      });
      const blank = core.instantiate();
      const blankInstanceBytes = blank.memoryBytes;
      blank.createTerminal(120, 40, terminalOptions);
      const withTerminalBytes = blank.memoryBytes;
      blank.dispose();
      // Linear memory summed over one instance per terminal (0 models: 0 bytes).
      const models = [];
      const allocations = [{ models: 0, wasmBytes: core.getMemoryBytes() }];
      for (let count = 1; count <= 20; count++) {
        models.push(core.createTerminal(120, 40, terminalOptions));
        if ([1, 5, 10, 20].includes(count))
          allocations.push({ models: count, wasmBytes: core.getMemoryBytes() });
      }
      for (const model of models) model.dispose();
      const instanceBase = {
        stackBytes: layout.stackTop,
        initialPages: layout.initialPages,
        blankInstanceBytes,
        withTerminalBytes,
        terminalIncrementBytes: withTerminalBytes - blankInstanceBytes,
        twentyModelsPerModelBytes: allocations[allocations.length - 1].wasmBytes / 20,
      };
      const instantiation = await instantiationLatency(core, bytes);
      const lifecycles = [
        await lifecycle(core, "private"),
        await lifecycle(core, "shared"),
      ];
      const timings: Record<string, number[]> = {};
      for (const [name, fixtures] of Object.entries(workloads)) {
        const samples = [];
        for (let sample = 0; sample < 7; sample++) {
          const model = core.createTerminal(120, 40, {
            maxScrollbackBytes: 8 * 1024 * 1024,
            maxScrollbackLines: 10_000,
          });
          try {
            if (gpuFormat) model.setRenderFormat("gpu");
            const update = () => {
              if (!gpuFormat) return model.updateRenderState();
              const state = model.updateGpuRenderState();
              model.acknowledgeGpuGlyphs();
              return state;
            };
            model.write(encode("initial output\r\n".repeat(40)));
            update();
            const start = performance.now();
            for (let index = 0; index < 10_000; index++) {
              model.write(fixtures[index % fixtures.length]);
              model.drainEvents();
              update();
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
        renderFormat: gpuFormat ? "gpu" : "soa",
        allocations,
        instanceBase,
        instantiation,
        lifecycles,
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
