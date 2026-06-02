import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PI_PACKAGE_NAMES } from "./protocol.js";

const HOST_PATH = fileURLToPath(new URL("./host.js", import.meta.url));

function readResponse(lines) {
  return new Promise((resolve) => {
    lines.once("line", (line) => resolve(JSON.parse(line)));
  });
}

function writeRequest(child, id, method, params) {
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
  );
}

describe("Pi host stdio", () => {
  it("exchanges JSON-RPC messages over newline-delimited stdio", async () => {
    const child = spawn(process.execPath, [HOST_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });

    try {
      writeRequest(child, 1, "status");
      await expect(readResponse(lines)).resolves.toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          phase: "ready",
          piSdkLoaded: true,
          piPackages: expect.arrayContaining([
            expect.objectContaining({
              name: "@earendil-works/pi-coding-agent",
              loaded: true,
            }),
          ]),
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
      env: {
        ...process.env,
        TERAX_PI_HOST_TEST_FAUX_RESPONSE: "stdio safe response",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });

    try {
      writeRequest(child, 1, "sessions.create", { title: "stdio" });
      await expect(readResponse(lines)).resolves.toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: { session: { id: "pi-1", status: "idle" } },
      });

      writeRequest(child, 2, "sessions.send", {
        sessionId: "pi-1",
        prompt: "hello",
      });
      const sent = await readResponse(lines);
      expect(sent).toMatchObject({
        jsonrpc: "2.0",
        id: 2,
        result: { accepted: true, session: { status: "idle" } },
      });
      expect(
        sent.result.events
          .filter((event) => event.type === "session.output.delta")
          .map((event) => event.payload.text)
          .join(""),
      ).toBe("stdio safe response");

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
});
