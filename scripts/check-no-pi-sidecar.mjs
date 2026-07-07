#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const forbiddenPathPatterns = [
  /(^|\/)sidecars\/(pi-host|node)(\/|$)/,
  /(^|\/)src-tauri\/resources\/sidecars\/(pi-host|node)(\/|$)/,
  /(^|\/)scripts\/(build-pi-host-bundle|build-node-runtime|smoke-pi-host-bundle)\.mjs$/,
];

const forbiddenGeneratedDirs = [
  "sidecars/pi-host",
  "sidecars/node",
  "src-tauri/resources/sidecars/pi-host",
  "src-tauri/resources/sidecars/node",
];

const forbiddenConfigText = [
  "sidecars/pi-host",
  "sidecars/node",
  "build-pi-host-bundle",
  "build-node-runtime",
  "smoke-pi-host-bundle",
  "smoke:pi-host",
];

const configFiles = [
  "package.json",
  "pnpm-workspace.yaml",
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.linux.conf.json",
  "src-tauri/tauri.windows.conf.json",
];

async function trackedFiles(root) {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files"], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.split("\n").filter(Boolean);
  } catch {
    return walkFiles(root);
  }
}

async function walkFiles(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "target") {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, path)));
    } else if (entry.isFile()) {
      files.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  return files;
}

function hasForbiddenPath(path) {
  return forbiddenPathPatterns.some((pattern) => pattern.test(path));
}

async function readIfPresent(root, relativePath) {
  try {
    return await readFile(resolve(root, relativePath), "utf8");
  } catch {
    return null;
  }
}

function checkPackageJson(text, errors) {
  if (!text) return;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    errors.push(`package.json could not be parsed: ${error.message}`);
    return;
  }

  const scripts = parsed.scripts ?? {};
  for (const [name, command] of Object.entries(scripts)) {
    if (name === "build:sidecars" && command === "node scripts/build-speech-recognizer.mjs") {
      continue;
    }
    for (const needle of forbiddenConfigText) {
      if (`${name} ${command}`.includes(needle)) {
        errors.push(`package.json script ${name} reintroduces Pi sidecar text: ${needle}`);
      }
    }
  }
}

function checkTauriConfig(text, path, errors) {
  if (!text) return;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    errors.push(`${path} could not be parsed: ${error.message}`);
    return;
  }

  const serialized = JSON.stringify({
    beforeBuildCommand: parsed.build?.beforeBuildCommand,
    resources: parsed.bundle?.resources,
  });
  for (const needle of forbiddenConfigText) {
    if (serialized.includes(needle)) {
      errors.push(`${path} reintroduces Pi sidecar resource or build text: ${needle}`);
    }
  }
}

function checkPlainConfig(text, path, errors) {
  if (!text) return;
  for (const needle of forbiddenConfigText) {
    if (text.includes(needle)) {
      errors.push(`${path} reintroduces Pi sidecar text: ${needle}`);
    }
  }
}

export async function checkNoPiSidecar(root = repoRoot) {
  const errors = [];
  const files = await trackedFiles(root);

  for (const file of files) {
    if (hasForbiddenPath(file)) {
      errors.push(`tracked Pi sidecar path is present: ${file}`);
    }
  }

  for (const dir of forbiddenGeneratedDirs) {
    if (existsSync(resolve(root, dir))) {
      errors.push(`Pi sidecar directory is present: ${dir}`);
    }
  }

  for (const path of configFiles) {
    const text = await readIfPresent(root, path);
    if (path === "package.json") {
      checkPackageJson(text, errors);
    } else if (path.endsWith("tauri.conf.json")) {
      checkTauriConfig(text, path, errors);
    } else {
      checkPlainConfig(text, path, errors);
    }
  }

  return { ok: errors.length === 0, errors, trackedFiles: files.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkNoPiSidecar(repoRoot);
  if (!result.ok) {
    console.error("No Pi sidecar check failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`No Pi sidecar check passed: scanned ${result.trackedFiles} tracked files and sidecar config.`);
}
