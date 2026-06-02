import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bundledNode =
  process.platform === "win32"
    ? join(repoRoot, "sidecars", "node", "dist", "node.exe")
    : join(repoRoot, "sidecars", "node", "dist", "bin", "node");
const bundledHost = join(repoRoot, "sidecars", "pi-host", "dist", "host.js");

async function assertFile(path) {
  const entry = await stat(path);
  if (!entry.isFile()) {
    throw new Error(`Expected file: ${path}`);
  }
}

function readEnvelope(lines) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for Pi host response")),
      15_000,
    );
    lines.once("line", (line) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function writeRequest(child, id, method) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method })}\n`);
}

async function request(child, lines, id, method) {
  writeRequest(child, id, method);
  const response = await readEnvelope(lines);
  if (response.id !== id) {
    throw new Error(
      `Expected response id ${id}, received ${JSON.stringify(response)}`,
    );
  }
  if (response.error) {
    throw new Error(`Pi host error: ${response.error.message}`);
  }
  return response.result;
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
  },
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({ input: child.stdout });
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

try {
  const status = await request(child, lines, 1, "status");
  if (status.phase !== "ready" || status.piSdkLoaded !== true) {
    throw new Error(`Unexpected Pi host status: ${JSON.stringify(status)}`);
  }
  if (
    !status.piPackages.some(
      (pkg) => pkg.name === "@earendil-works/pi-coding-agent" && pkg.loaded,
    )
  ) {
    throw new Error(
      "Bundled Pi host did not load @earendil-works/pi-coding-agent",
    );
  }

  const diagnostics = await request(child, lines, 2, "diagnostics");
  if (
    typeof diagnostics.node.version !== "string" ||
    !diagnostics.node.version.startsWith("v")
  ) {
    throw new Error(
      `Unexpected bundled Node version: ${diagnostics.node.version}`,
    );
  }
  if (diagnostics.config.toolMode !== "noTools") {
    throw new Error(`Unexpected tool mode: ${diagnostics.config.toolMode}`);
  }

  await request(child, lines, 3, "shutdown");
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
