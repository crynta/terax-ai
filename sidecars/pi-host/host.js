import { createInterface } from "node:readline";
import { handleJsonRpcLine } from "./protocol.js";

const writeProtocolStdout = process.stdout.write.bind(process.stdout);
const writeIncidentalStdoutToStderr = process.stderr.write.bind(process.stderr);

// The Pi SDK may write terminal notifications or diagnostics to stdout. Keep
// JSON-RPC stdout framed by redirecting incidental process.stdout writes to
// stderr and using the captured writer only for protocol envelopes below.
process.stdout.write = (...args) => writeIncidentalStdoutToStderr(...args);

const lines = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function writeResponse(response) {
  return new Promise((resolve, reject) => {
    writeProtocolStdout(`${JSON.stringify(response)}\n`, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

for await (const line of lines) {
  if (line.trim() === "") {
    continue;
  }

  const result = await handleJsonRpcLine(line);
  await writeResponse(result.response);

  if (result.shutdown) {
    lines.close();
    process.exit(0);
  }
}
