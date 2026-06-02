import { createInterface } from "node:readline";
import { handleJsonRpcLine } from "./protocol.js";

const lines = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

for await (const line of lines) {
  if (line.trim() === "") {
    continue;
  }

  const result = handleJsonRpcLine(line);
  process.stdout.write(`${JSON.stringify(result.response)}\n`);

  if (result.shutdown) {
    lines.close();
    break;
  }
}
