import { TeraxGhostty } from "@terax/ghostty-core/adapted";

declare const WASM_BASE64: string;
declare const OPEN: number;
declare const CLOSE: number;
declare const RECLAIM: boolean;

type Message = { postMessage(value: string): void };
const post = (value: string) =>
  (
    window as unknown as { webkit: { messageHandlers: { out: Message } } }
  ).webkit.messageHandlers.out.postMessage(value);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// "PHASE" lines make the orchestrator sample the WebContent footprint a second
// later, after the script has gone idle, which is what a user's open window does.
(async () => {
  const bytes = Uint8Array.from(atob(WASM_BASE64), (c) => c.charCodeAt(0));
  const core = await TeraxGhostty.loadBytes(
    bytes.buffer,
    RECLAIM ? {} : { reclaim: null },
  );
  const line = new TextEncoder().encode(
    "heavy scrollback line with some words and a number 123456789 more text here for the test\r\n",
  );
  const chunk = new Uint8Array(line.length * 500);
  for (let index = 0; index < 500; index++) chunk.set(line, index * line.length);

  await sleep(1500);
  post("PHASE baseline");
  await sleep(3000);
  const terminals: ReturnType<typeof core.createTerminal>[] = [];
  const started = performance.now();
  for (let index = 0; index < OPEN; index++) {
    const terminal = core.createTerminal(120, 40, {
      maxScrollbackBytes: 8 << 20,
      maxScrollbackLines: 10_000,
    });
    for (let write = 0; write < 30; write++) terminal.write(chunk);
    terminal.updateRenderState();
    terminals.push(terminal);
  }
  post(
    `PHASE opened ${OPEN} wasmBytes=${core.getMemoryBytes()} openMs=${(performance.now() - started).toFixed(0)}`,
  );
  await sleep(3500);
  for (let index = 0; index < CLOSE; index++) terminals.pop()?.dispose();
  post(`PHASE closed ${CLOSE} kept=${terminals.length} wasmBytes=${core.getMemoryBytes()}`);
  await sleep(7000);
  post("PHASE settled after partial close");
  await sleep(1500);
  while (terminals.length > 0) terminals.pop()?.dispose();
  post(`PHASE closed all wasmBytes=${core.getMemoryBytes()}`);
  await sleep(7000);
  post("PHASE settled after closing all");
  await sleep(1500);
  post("DONE");
})().catch((error) => {
  post(`ERROR ${error} ${error?.stack}`);
  post("DONE");
});
