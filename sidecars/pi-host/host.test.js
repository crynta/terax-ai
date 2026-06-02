import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOST_PATH = fileURLToPath(new URL("./host.js", import.meta.url));

function readResponse(lines) {
  return new Promise((resolve) => {
    lines.once("line", (line) => resolve(JSON.parse(line)));
  });
}

describe("Pi host stdio", () => {
  it("exchanges JSON-RPC messages over newline-delimited stdio", async () => {
    const child = spawn(process.execPath, [HOST_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });

    try {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status" })}\n`,
      );
      await expect(readResponse(lines)).resolves.toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: { phase: "ready", piSdkLoaded: false },
      });

      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "shutdown" })}\n`,
      );
      await expect(readResponse(lines)).resolves.toEqual({
        jsonrpc: "2.0",
        id: 2,
        result: { ok: true },
      });
      await new Promise((resolve) => child.once("exit", resolve));
      expect(child.exitCode).toBe(0);
    } finally {
      lines.close();
      child.kill();
    }
  });
});
