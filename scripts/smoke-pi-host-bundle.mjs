import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bundledNode =
  process.env.TERAX_PI_HOST_SMOKE_NODE ??
  (process.platform === "win32"
    ? join(repoRoot, "sidecars", "node", "dist", "node.exe")
    : join(repoRoot, "sidecars", "node", "dist", "bin", "node"));
const bundledHost =
  process.env.TERAX_PI_HOST_SMOKE_HOST ??
  join(repoRoot, "sidecars", "pi-host", "dist", "host.js");

async function assertFile(path) {
  const entry = await stat(path);
  if (!entry.isFile()) {
    throw new Error(`Expected file: ${path}`);
  }
}

function createEnvelopeReader(input) {
  const lines = createInterface({ input });
  const queue = [];
  const waiters = [];

  lines.on("line", (line) => {
    let envelope;
    try {
      envelope = JSON.parse(line);
    } catch (error) {
      const waiter = waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      return;
    }

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
    read: (timeoutMs = 15_000) => {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift());
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          reject,
          resolve,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) {
              waiters.splice(index, 1);
            }
            reject(new Error("Timed out waiting for Pi host response"));
          }, timeoutMs),
        };
        waiters.push(waiter);
      });
    },
  };
}

function writeRequest(child, id, method, params) {
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
  );
}

async function request(child, reader, id, method, params) {
  writeRequest(child, id, method, params);
  while (true) {
    const response = await reader.read();
    if (response.id !== id) {
      if (response.method === "session.event") {
        continue;
      }
      throw new Error(
        `Expected response id ${id}, received ${JSON.stringify(response)}`,
      );
    }
    if (response.error) {
      throw new Error(`Pi host error: ${response.error.message}`);
    }
    return response.result;
  }
}

await assertFile(bundledNode);
await assertFile(bundledHost);

const cwd = await mkdtemp(join(tmpdir(), "terax-pi-host-smoke-"));
const child = spawn(bundledNode, [bundledHost], {
  cwd,
  env: {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    USERPROFILE: process.env.USERPROFILE ?? "",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    TEMP: process.env.TEMP ?? tmpdir(),
    TMP: process.env.TMP ?? tmpdir(),
    TERAX_PI_HOST_ENABLE_TEST_FAUX: "1",
    TERAX_PI_HOST_TEST_FAUX_RESPONSE: "smoke ok",
  },
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createEnvelopeReader(child.stdout);
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

try {
  const status = await request(child, lines, 1, "status");
  if (status.phase !== "ready") {
    throw new Error(`Unexpected Pi host status: ${JSON.stringify(status)}`);
  }

  const diagnostics = await request(child, lines, 2, "diagnostics");
  if (
    !diagnostics.piPackages.some(
      (pkg) => pkg.name === "@earendil-works/pi-coding-agent" && pkg.loaded,
    )
  ) {
    throw new Error(
      "Bundled Pi host did not load @earendil-works/pi-coding-agent",
    );
  }
  if (
    typeof diagnostics.node.version !== "string" ||
    !diagnostics.node.version.startsWith("v")
  ) {
    throw new Error(
      `Unexpected bundled Node version: ${diagnostics.node.version}`,
    );
  }
  if (diagnostics.config.toolMode !== "rust-mediated") {
    throw new Error(`Unexpected tool mode: ${diagnostics.config.toolMode}`);
  }
  const enabledTools = diagnostics.config.enabledTools ?? [];
  const approvalTools = diagnostics.config.approvalRequiredTools ?? [];
  const expectedEnabledTools = [
    "read",
    "ls",
    "grep",
    "find",
    "bash",
    "edit",
    "write",
    "create_artifact",
    "edit_artifact",
    "read_artifact",
    "list_artifacts",
  ];
  const expectedApprovalTools = ["bash", "edit", "write"];
  if (JSON.stringify(enabledTools) !== JSON.stringify(expectedEnabledTools)) {
    throw new Error(
      `Bundled Pi host enabled unexpected tools: ${enabledTools.join(", ")}`,
    );
  }
  if (JSON.stringify(approvalTools) !== JSON.stringify(expectedApprovalTools)) {
    throw new Error(
      `Bundled Pi host exposed unexpected approval tools: ${approvalTools.join(", ")}`,
    );
  }

  const created = await request(child, lines, 3, "sessions.create", {
    title: "Smoke",
    cwd,
  });
  if (created.session?.status !== "idle" || created.session?.cwd !== cwd) {
    throw new Error(`Unexpected created session: ${JSON.stringify(created)}`);
  }
  const sent = await request(child, lines, 4, "sessions.send", {
    sessionId: created.session.id,
    prompt: "Reply with the smoke fixture.",
  });
  if (sent.accepted !== true || sent.session?.status !== "running") {
    throw new Error(`Unexpected send result: ${JSON.stringify(sent)}`);
  }

  await request(child, lines, 5, "shutdown");
  await new Promise((resolve) => child.once("exit", resolve));
  if (child.exitCode !== 0) {
    throw new Error(`Pi host exited with ${child.exitCode}; stderr: ${stderr}`);
  }
  console.log("Pi host bundle smoke passed");
} finally {
  lines.close();
  child.kill();
  await rm(cwd, { recursive: true, force: true });
}
