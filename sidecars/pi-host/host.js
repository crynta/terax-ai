import { createInterface } from "node:readline";
import { handleJsonRpcLine } from "./protocol.js";
import { setSessionEventSink } from "./sessions.js";

const writeProtocolStdout = process.stdout.write.bind(process.stdout);
const writeIncidentalStdoutToStderr = process.stderr.write.bind(process.stderr);

// The Pi SDK may write terminal notifications or diagnostics to stdout. Keep
// JSON-RPC stdout framed by redirecting incidental process.stdout writes to
// stderr and using the captured writer only for protocol envelopes below.
process.stdout.write = (chunk, encoding, callback) =>
  writeIncidentalStdoutToStderr(chunk, encoding, callback);

process.on("unhandledRejection", (error) => {
  writeIncidentalStdoutToStderr(
    `Pi host unhandled rejection: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});

process.stdout.on("error", (error) => {
  if (error?.code === "EPIPE") {
    process.exit(0);
  }
});

const lines = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let protocolWriteQueue = Promise.resolve();

function writeProtocolEnvelope(envelope) {
  return new Promise((resolve, reject) => {
    writeProtocolStdout(`${JSON.stringify(envelope)}\n`, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function enqueueProtocolEnvelope(envelope) {
  protocolWriteQueue = protocolWriteQueue
    .then(() => writeProtocolEnvelope(envelope))
    .catch((error) => {
      writeIncidentalStdoutToStderr(
        `Pi host protocol write failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
  return protocolWriteQueue;
}

setSessionEventSink((event) => {
  void enqueueProtocolEnvelope({
    jsonrpc: "2.0",
    method: "session.event",
    params: event,
  });
});

for await (const line of lines) {
  if (line.trim() === "") {
    continue;
  }

  const result = await handleJsonRpcLine(line);
  await enqueueProtocolEnvelope(result.response);

  if (result.shutdown) {
    lines.close();
    await protocolWriteQueue;
    process.exit(0);
  }
}
