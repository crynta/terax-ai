import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PI_PACKAGE_NAMES } from "./protocol.js";

const HOST_PATH = fileURLToPath(new URL("./host.js", import.meta.url));

function hostEnv(extra = {}) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    USERPROFILE: process.env.USERPROFILE ?? "",
    TMPDIR: process.env.TMPDIR ?? "",
    TEMP: process.env.TEMP ?? "",
    TMP: process.env.TMP ?? "",
    ...extra,
  };
}

function createEnvelopeReader(input) {
  const lines = createInterface({ input });
  const queue = [];
  const waiters = [];

  lines.on("line", (line) => {
    const envelope = JSON.parse(line);
    const waiter = waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(envelope);
    } else {
      queue.push(envelope);
    }
  });

  return {
    close: () => lines.close(),
    read: (timeoutMs = 3000) => {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift());
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) {
              waiters.splice(index, 1);
            }
            reject(new Error("Timed out waiting for host envelope"));
          }, timeoutMs),
        };
        waiters.push(waiter);
      });
    },
  };
}

function readResponse(reader) {
  return reader.read();
}

function writeRequest(child, id, method, params) {
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
  );
}

async function readUntil(reader, predicate, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const envelope = await reader.read(deadline - Date.now());
    if (predicate(envelope)) {
      return envelope;
    }
  }
  throw new Error("Timed out waiting for host envelope");
}

describe("Pi host stdio", () => {
  it("exchanges JSON-RPC messages over newline-delimited stdio", async () => {
    const child = spawn(process.execPath, [HOST_PATH], {
      env: hostEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createEnvelopeReader(child.stdout);

    try {
      writeRequest(child, 1, "status");
      await expect(readResponse(lines)).resolves.toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: {
          phase: "ready",
          detail: "Pi host ready",
        },
      });

      writeRequest(child, 2, "info");
      const info = await readResponse(lines);
      expect(info).toMatchObject({
        jsonrpc: "2.0",
        id: 2,
        result: {
          hostVersion: "0.1.0",
          piSdkLoaded: true,
        },
      });
      expect(info.result.piPackages.map((pkg) => pkg.name)).toEqual(
        PI_PACKAGE_NAMES,
      );

      writeRequest(child, 3, "shutdown");
      await expect(readResponse(lines)).resolves.toEqual({
        jsonrpc: "2.0",
        id: 3,
        result: { ok: true },
      });
      await new Promise((resolve) => child.once("exit", resolve));
      expect(child.exitCode).toBe(0);
    } finally {
      lines.close();
      child.kill();
    }
  });

  it("keeps Pi SDK stdout writes off the JSON-RPC stream", async () => {
    const child = spawn(process.execPath, [HOST_PATH], {
      env: hostEnv({
        TERAX_PI_HOST_TEST_FAUX_RESPONSE: "stdio safe response",
        TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND: "",
      }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createEnvelopeReader(child.stdout);

    try {
      writeRequest(child, 1, "sessions.create", { title: "stdio" });
      const created = await readResponse(lines);
      expect(created).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          session: { id: expect.stringMatching(/^pi_/), status: "idle" },
        },
      });
      const sessionId = created.result.session.id;

      writeRequest(child, 2, "sessions.send", {
        sessionId,
        prompt: "hello",
      });
      const sent = await readResponse(lines);
      expect(sent).toMatchObject({
        jsonrpc: "2.0",
        id: 2,
        result: { accepted: true, session: { status: "running" } },
      });

      const deltas = [];
      let finalText = null;
      await readUntil(
        lines,
        (envelope) => {
          if (envelope.method !== "session.event") {
            return false;
          }
          if (envelope.params.type === "session.output.delta") {
            deltas.push(envelope.params.payload.text);
          }
          if (envelope.params.type === "session.output.text") {
            finalText = envelope.params.payload.text;
          }
          return (
            envelope.params.type === "session.status" &&
            envelope.params.payload.status === "idle"
          );
        },
        10_000,
      );
      expect(deltas.join("")).toBe("stdio safe response");
      expect(finalText).toBe("stdio safe response");

      writeRequest(child, 3, "shutdown");
      await expect(readResponse(lines)).resolves.toEqual({
        jsonrpc: "2.0",
        id: 3,
        result: { ok: true },
      });
      await new Promise((resolve) => child.once("exit", resolve));
      expect(child.exitCode).toBe(0);
    } finally {
      lines.close();
      child.kill();
    }
  }, 15_000);
});
