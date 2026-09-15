import { readFile } from "node:fs/promises";
import {
  TeraxGhostty,
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
  }
});

afterAll(() => {
  for (const terminal of terminals) terminal.dispose();
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
}
