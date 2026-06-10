import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const nodeRuntimeDir = join(repoRoot, "sidecars", "node");
export const nodeRuntimeDistDir = join(nodeRuntimeDir, "dist");
export const DEFAULT_NODE_RUNTIME_VERSION = "24.16.0";
const tempDir = join(nodeRuntimeDir, `.dist-tmp-${process.pid}-${Date.now()}`);

export function nodeBinaryRelativePath(platform = process.platform) {
  return platform === "win32" ? "node.exe" : join("bin", "node");
}

export function nodeDistributionPlatform(platform = process.platform) {
  switch (platform) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    case "win32":
      return "win";
    default:
      throw new Error(`Unsupported Node runtime platform: ${platform}`);
  }
}

export function nodeDistributionArch(arch = process.arch) {
  switch (arch) {
    case "arm64":
      return "arm64";
    case "x64":
      return "x64";
    default:
      throw new Error(`Unsupported Node runtime architecture: ${arch}`);
  }
}

export function nodeDistributionName({
  version = process.version.slice(1),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  return `node-v${version}-${nodeDistributionPlatform(platform)}-${nodeDistributionArch(arch)}`;
}

export function nodeDistributionArchiveName(options = {}) {
  const platform = options.platform ?? process.platform;
  const name = nodeDistributionName({ ...options, platform });
  return `${name}.${platform === "win32" ? "zip" : "tar.gz"}`;
}

function nodeDistributionBaseUrl(version) {
  return `https://nodejs.org/dist/v${version}`;
}

export function parseNodeShasums(contents, archiveName) {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{6,})\s+(.+)$/);
    if (match?.[2] === archiveName) {
      return match[1].toLowerCase();
    }
  }
  throw new Error(`Node SHASUMS256.txt did not contain ${archiveName}`);
}

async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function downloadText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

async function verifyDownloadedArchive({ archivePath, archiveName, version }) {
  const shasumsUrl = `${nodeDistributionBaseUrl(version)}/SHASUMS256.txt`;
  const expected = parseNodeShasums(
    await downloadText(shasumsUrl),
    archiveName,
  );
  const actual = await sha256File(archivePath);
  if (actual !== expected) {
    throw new Error(
      `Node runtime archive checksum mismatch for ${archiveName}: expected ${expected}, got ${actual}`,
    );
  }
  return { sha256: actual, shasumsUrl };
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
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

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyLocalNode({ source, target }) {
  const sourceStat = await stat(source);
  if (!sourceStat.isFile()) {
    throw new Error(`Node runtime source is not a file: ${source}`);
  }

  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
  if (process.platform !== "win32") {
    await chmod(target, 0o755);
  }
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }

  await mkdir(dirname(destination), { recursive: true });
  await finished(
    Readable.fromWeb(response.body).pipe(createWriteStream(destination)),
  );
}

async function extractDownloadedNode({ archivePath, distributionName }) {
  if (process.platform === "win32") {
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${tempDir}' -Force`,
    ]);
    const extractedNode = join(tempDir, distributionName, "node.exe");
    await copyLocalNode({
      source: extractedNode,
      target: join(tempDir, nodeBinaryRelativePath("win32")),
    });
    return;
  }

  await run("tar", ["-xzf", archivePath, "-C", tempDir]);
  const extractedNode = join(tempDir, distributionName, "bin", "node");
  await copyLocalNode({
    source: extractedNode,
    target: join(tempDir, nodeBinaryRelativePath()),
  });
  await rm(archivePath, { force: true });
  await rm(join(tempDir, distributionName), { recursive: true, force: true });
}

async function buildDownloadedNode(version) {
  const distributionName = nodeDistributionName({ version });
  const archiveName = nodeDistributionArchiveName({
    version,
    platform: process.platform,
  });
  const archivePath = join(tempDir, archiveName);
  const url = `${nodeDistributionBaseUrl(version)}/${archiveName}`;

  await downloadFile(url, archivePath);
  const verification = await verifyDownloadedArchive({
    archivePath,
    archiveName,
    version,
  });
  await extractDownloadedNode({ archivePath, distributionName });
  return {
    strategy: "download",
    source: url,
    archiveName,
    archiveSha256: verification.sha256,
    shasumsUrl: verification.shasumsUrl,
    nodeVersion: version,
  };
}

async function buildLocalNode() {
  const source = process.env.TERAX_NODE_BINARY || process.execPath;
  const target = join(tempDir, nodeBinaryRelativePath());
  await copyLocalNode({ source, target });
  return {
    strategy: "copy-local",
    source,
    nodeVersion: process.version.slice(1),
  };
}

// Strip debug symbols from the Node binary. The official Node distribution
// ships an unstripped binary (~120MB on arm64); removing local symbols cuts
// roughly a third with no runtime impact. macOS arm64 binaries must carry a
// valid signature to execute, and `strip` invalidates it, so we re-sign
// ad-hoc afterward (Tauri re-signs with the real identity at bundle time).
async function stripNodeBinary(binaryPath) {
  if (process.platform === "win32") {
    return { stripped: false, reason: "windows-unsupported" };
  }

  try {
    if (process.platform === "darwin") {
      // -x removes local symbols only; keeps the binary fully functional.
      await run("strip", ["-x", binaryPath]);
      // strip invalidated the signature — ad-hoc re-sign so it can run.
      await run("codesign", ["--force", "--sign", "-", binaryPath]);
    } else {
      await run("strip", [binaryPath]);
    }
    return { stripped: true };
  } catch (error) {
    // Never break the build over an optional size optimization; the
    // unstripped binary remains valid and functional.
    console.warn(
      `[node-runtime] Skipped stripping Node binary: ${error.message}`,
    );
    return { stripped: false, reason: "strip-failed" };
  }
}

async function assertRuntimeFile(relativePath) {
  const path = join(tempDir, relativePath);
  if (!(await pathExists(path))) {
    throw new Error(`Node runtime bundle missing ${relativePath}`);
  }
}

export function selectedSource(
  argv = process.argv.slice(2),
  env = process.env,
) {
  if (argv.includes("--download")) {
    return "download";
  }
  if (argv.includes("--local")) {
    return "local";
  }
  if (env.TERAX_NODE_RUNTIME_SOURCE) {
    return env.TERAX_NODE_RUNTIME_SOURCE;
  }
  return env.CI === "true" ? "download" : "local";
}

export async function buildNodeRuntime(argv = process.argv.slice(2)) {
  const source = selectedSource(argv);
  const version =
    process.env.TERAX_NODE_RUNTIME_VERSION ?? DEFAULT_NODE_RUNTIME_VERSION;

  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  try {
    if (!["download", "local"].includes(source)) {
      throw new Error(
        `Unsupported TERAX_NODE_RUNTIME_SOURCE: ${source}. Use "download" or "local".`,
      );
    }

    const manifest =
      source === "download"
        ? await buildDownloadedNode(version)
        : await buildLocalNode();

    await assertRuntimeFile(nodeBinaryRelativePath());
    const stripResult = await stripNodeBinary(
      join(tempDir, nodeBinaryRelativePath()),
    );
    await writeFile(join(tempDir, ".gitkeep"), "");
    await writeFile(
      join(tempDir, "runtime-manifest.json"),
      `${JSON.stringify(
        {
          name: "@terax/node-runtime",
          generatedAt: new Date().toISOString(),
          platform: process.platform,
          arch: process.arch,
          executable: nodeBinaryRelativePath(),
          stripped: stripResult.stripped,
          ...manifest,
        },
        null,
        2,
      )}\n`,
    );

    await rm(nodeRuntimeDistDir, { recursive: true, force: true });
    await rename(tempDir, nodeRuntimeDistDir);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await buildNodeRuntime();
}
