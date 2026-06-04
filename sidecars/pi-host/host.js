import { createInterface } from "node:readline";
import { setNativeToolExecutor } from "./native-tools.js";
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
let nextHostRequestId = 1;
const pendingHostRequests = new Map();

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

function sendHostRequest(method, params, signal) {
  const id = nextHostRequestId;
  nextHostRequestId += 1;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      pendingHostRequests.delete(id);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("Operation aborted"));
    };
    if (signal?.aborted) {
      reject(new Error("Operation aborted"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    pendingHostRequests.set(id, { cleanup, reject, resolve });
    void enqueueProtocolEnvelope({ jsonrpc: "2.0", id, method, params });
  });
}

function tryResolveHostResponse(line) {
  let envelope;
  try {
    envelope = JSON.parse(line);
  } catch {
    return false;
  }
  if (
    !envelope ||
    envelope.jsonrpc !== "2.0" ||
    typeof envelope.id !== "number" ||
    envelope.method !== undefined ||
    !pendingHostRequests.has(envelope.id)
  ) {
    return false;
  }
  const pending = pendingHostRequests.get(envelope.id);
  pending.cleanup();
  if (envelope.error) {
    const message = envelope.error.message ?? "Terax native tool request failed";
    const error = new Error(message);
    error.data = envelope.error.data;
    pending.reject(error);
  } else {
    pending.resolve(envelope.result);
  }
  return true;
}

setNativeToolExecutor((request, signal) =>
  sendHostRequest("nativeTools.execute", request, signal),
);

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

  if (tryResolveHostResponse(line)) {
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
