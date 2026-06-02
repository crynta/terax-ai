import { spawn } from "node:child_process";
import { rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const piHostDir = join(repoRoot, "sidecars", "pi-host");
const bundleDir = join(piHostDir, "dist");
const tempDir = join(piHostDir, `.dist-tmp-${process.pid}-${Date.now()}`);

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

async function assertBundleFile(relativePath) {
  const path = join(tempDir, relativePath);
  if (!(await pathExists(path))) {
    throw new Error(`Pi host bundle missing ${relativePath}`);
  }
}

try {
  await rm(tempDir, { recursive: true, force: true });
  await run("pnpm", [
    "--filter",
    "@terax/pi-host",
    "deploy",
    "--prod",
    "--legacy",
    tempDir,
  ]);

  for (const testFile of ["host.test.js", "protocol.test.js"]) {
    await rm(join(tempDir, testFile), { force: true });
  }

  await assertBundleFile("host.js");
  await assertBundleFile("protocol.js");
  await assertBundleFile("package.json");
  await assertBundleFile(
    "node_modules/@earendil-works/pi-coding-agent/package.json",
  );

  await writeFile(
    join(tempDir, "bundle-manifest.json"),
    `${JSON.stringify(
      {
        name: "@terax/pi-host",
        generatedAt: new Date().toISOString(),
        strategy: "pnpm deploy --prod --legacy",
      },
      null,
      2,
    )}\n`,
  );

  await rm(bundleDir, { recursive: true, force: true });
  await rename(tempDir, bundleDir);
  await writeFile(join(bundleDir, ".gitkeep"), "");
} catch (error) {
  await rm(tempDir, { recursive: true, force: true });
  throw error;
}
