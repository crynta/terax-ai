import { cpSync, chmodSync, mkdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(root, "src-tauri");
const release = process.argv.includes("--release");

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
  });
  if (result.error) {
    process.stderr.write(`Could not run ${command}: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (capture) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

function hostTriple() {
  const output = run("rustc", ["-vV"], { capture: true });
  const match = output.match(/^host:\s+(.+)$/m);
  if (!match) {
    process.stderr.write("rustc did not report a host target triple\n");
    process.exit(1);
  }
  return match[1].trim();
}

function requireArtifact(path, label) {
  try {
    const artifact = statSync(path);
    if (artifact.isFile() && artifact.size > 0) return;
  } catch {}
  process.stderr.write(`${label} is missing or empty: ${path}\n`);
  process.exit(1);
}

const target =
  process.env.TERAX_CLI_TARGET?.trim() ||
  process.env.CARGO_BUILD_TARGET?.trim() ||
  hostTriple();
const cargoArgs = [
  "build",
  "--locked",
  "--manifest-path",
  join(tauriDir, "Cargo.toml"),
  "--package",
  "terax-cli",
  "--bin",
  "terax-cli",
  "--target",
  target,
];
if (release) cargoArgs.push("--release");

run("cargo", cargoArgs);

const extension = target.includes("windows") ? ".exe" : "";
const profile = release ? "release" : "debug";
const source = join(
  tauriDir,
  "target",
  target,
  profile,
  `terax-cli${extension}`,
);
const destination = join(
  tauriDir,
  "binaries",
  `terax-cli-${target}${extension}`,
);
requireArtifact(source, "Built CLI artifact");
mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination);
if (!extension) chmodSync(destination, 0o755);
requireArtifact(destination, "Prepared CLI sidecar");

console.log(`Prepared ${destination.slice(root.length + 1)}`);
