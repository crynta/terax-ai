import { spawn } from "node:child_process";
import process from "node:process";

const binary = process.argv[2];
if (!binary) {
  throw new Error("usage: node scripts/check-speech-bridge.mjs <binary>");
}

function request(operation, profile) {
  const frame = Buffer.alloc(20);
  frame.write("TRXQ", 0, "ascii");
  frame.writeUInt16LE(1, 4);
  frame.writeUInt8(operation, 6);
  frame.writeUInt8(profile, 7);
  return frame;
}

function response(data, offset, profile) {
  if (data.length < offset + 12) throw new Error("bridge response is truncated");
  if (data.toString("ascii", offset, offset + 4) !== "TRXP") {
    throw new Error("bridge response magic is invalid");
  }
  if (data.readUInt16LE(offset + 4) !== 1) {
    throw new Error("bridge protocol version does not match");
  }
  if (data.readUInt8(offset + 6) !== 0 || data.readUInt8(offset + 7) !== profile) {
    throw new Error("bridge returned an error response");
  }
  const length = data.readUInt32LE(offset + 8);
  const end = offset + 12 + length;
  if (end > data.length) throw new Error("bridge response body is truncated");
  return { body: data.toString("utf8", offset + 12, end), end };
}

const child = spawn(binary, [], {
  env: {
    ...process.env,
    TERAX_SPEECH_MODEL_DIR: process.cwd(),
    TERAX_SPEECH_SWIFT_MODEL_DIR: process.cwd(),
  },
  stdio: ["pipe", "pipe", "pipe"],
});
const stdout = [];
const stderr = [];
let stdoutBytes = 0;
let stderrBytes = 0;
child.stdout.on("data", (chunk) => {
  stdoutBytes += chunk.length;
  if (stdoutBytes > 2 * 1024 * 1024) child.kill();
  else stdout.push(chunk);
});
child.stderr.on("data", (chunk) => {
  if (stderrBytes >= 64 * 1024) return;
  const kept = chunk.subarray(0, 64 * 1024 - stderrBytes);
  stderr.push(kept);
  stderrBytes += kept.length;
});
child.stdin.end(Buffer.concat([request(2, 1), request(2, 2), request(3, 2)]));

const timeout = setTimeout(() => child.kill(), 10_000);
const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
clearTimeout(timeout);

if (exitCode !== 0) {
  throw new Error(
    `bridge exited with ${exitCode}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
  );
}
const output = Buffer.concat(stdout);
const nemotronReady = response(output, 0, 1);
const parakeetReady = response(output, nemotronReady.end, 2);
const bye = response(output, parakeetReady.end, 2);
if (
  nemotronReady.body !== "ready" ||
  parakeetReady.body !== "ready" ||
  bye.body !== "bye" ||
  bye.end !== output.length
) {
  throw new Error("bridge handshake response is invalid");
}
