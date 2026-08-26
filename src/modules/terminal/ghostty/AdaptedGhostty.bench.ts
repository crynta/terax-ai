import { readFile } from "node:fs/promises";
import type { TeraxGhosttyTerminal } from "@terax/ghostty-core/adapted";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { afterAll, beforeAll, bench, describe } from "vitest";

let terminal: TeraxGhosttyTerminal;
let streamingUpdate: Uint8Array;
let incrementalUpdates: readonly [Uint8Array, Uint8Array];
let incrementalIndex = 0;

beforeAll(async () => {
  const path = new URL(
    "../../../../packages/ghostty-core/adapted/ghostty-vt.wasm",
    import.meta.url,
  );
  const bytes = await readFile(path);
  const ghostty = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
  terminal = ghostty.createTerminal(120, 40, {
    maxScrollbackBytes: 8 * 1024 * 1024,
    maxScrollbackLines: 10_000,
  });
  streamingUpdate = new TextEncoder().encode(
    Array.from(
      { length: 1_024 },
      (_, index) =>
        `\r\x1b[2Kagent ${index}: analyzing repository and streaming tokens`,
    ).join(""),
  );
  incrementalUpdates = [
    new TextEncoder().encode("\x1b[10;1Hagent frame A"),
    new TextEncoder().encode("\x1b[10;1Hagent frame B"),
  ];
});

afterAll(() => terminal.dispose());

describe("adapted Ghostty AI-agent hot path", () => {
  bench("parse a bounded streaming update", () => {
    terminal.write(streamingUpdate);
  });

  bench("synchronize one changed agent row", () => {
    incrementalIndex ^= 1;
    terminal.write(incrementalUpdates[incrementalIndex]);
    terminal.updateRenderState();
  });

  bench("synchronize an unchanged visible state", () => {
    terminal.updateRenderState();
  });
});
