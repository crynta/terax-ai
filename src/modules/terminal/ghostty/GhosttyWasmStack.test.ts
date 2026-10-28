import { readFile } from "node:fs/promises";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { describe, expect, it } from "vitest";
import {
  adversarialInputs,
  fillStackCanary,
  peakStackBytes,
  readWasmLayout,
  runStackWorkloads,
} from "./wasmStackProbe";

const WASM_PAGE = 64 * 1024;
const MAX_STACK_BYTES = 128 * 1024;
const MAX_BLANK_INSTANCE_BYTES = 6 * WASM_PAGE;

describe.each([
  ["SIMD", "ghostty-vt.wasm"],
  ["scalar", "ghostty-vt-scalar.wasm"],
])("%s Ghostty artifact stack and base size", (_kind, artifact) => {
  async function load() {
    const file = await readFile(
      new URL(
        `../../../../packages/ghostty-core/adapted/${artifact}`,
        import.meta.url,
      ),
    );
    const bytes = Uint8Array.from(file);
    return {
      layout: readWasmLayout(bytes),
      core: await TeraxGhostty.loadBytes(bytes.buffer),
    };
  }

  it("keeps a small stack below the data so an overflow traps instead of corrupting memory", async () => {
    const { layout, core } = await load();
    expect(layout.stackTop).toBeGreaterThanOrEqual(32 * 1024);
    expect(layout.stackTop).toBeLessThanOrEqual(MAX_STACK_BYTES);
    expect(layout.dataStart).toBeGreaterThanOrEqual(layout.stackTop);
    expect(layout.initialPages * WASM_PAGE).toBeLessThanOrEqual(
      MAX_BLANK_INSTANCE_BYTES,
    );
    const instance = core.instantiate();
    expect(instance.memoryBytes).toBe(layout.initialPages * WASM_PAGE);
    instance.dispose();
  });

  it.each(["soa", "gpu"] as const)(
    "survives adversarial input with the %s render format within half of the stack",
    async (format) => {
      const { layout, core } = await load();
      const instance = core.instantiate();
      fillStackCanary(instance.exports.memory, layout.stackTop);
      const terminal = instance.createTerminal(120, 40, {
        maxScrollbackBytes: 8 * 1024 * 1024,
        maxScrollbackLines: 10_000,
      });
      try {
        const report = runStackWorkloads(terminal, format);
        expect(report.inputs).toBe(adversarialInputs().length);
        expect(report.bytes).toBeGreaterThan(30 * 1024 * 1024);
        const peak = peakStackBytes(instance.exports.memory, layout.stackTop);
        expect(peak).toBeGreaterThan(8 * 1024);
        expect(peak).toBeLessThanOrEqual(layout.stackTop / 2);
      } finally {
        terminal.dispose();
        instance.dispose();
      }
    },
    60_000,
  );
});
