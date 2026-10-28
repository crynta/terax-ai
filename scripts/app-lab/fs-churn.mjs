#!/usr/bin/env node
// File-system churn for the app lab `fs-churn` scenario (scripts/app-lab/run.py).
//
// Stands in for coding agents working in a repository the app has open in its explorer:
//   - agent edits: a source file is rewritten every 0.4 to 2.5 s, now and then a scratch file is
//     created in a source directory and removed again a few seconds later, a directory is made and
//     removed, a file is renamed;
//   - builds: every --build-every seconds a build writes --build-files files into `target/debug/
//     build/<generation>` (many small directories), `node_modules/.cache/<generation>` and rewrites
//     the bundles of `dist/assets`, spread over --build-seconds, and the generation before the
//     previous one is removed (disk use stays bounded, the directory listings keep changing).
//
//   fs-churn.mjs prepare ROOT [SOURCE_REPO]   copy the tracked files of SOURCE_REPO (HEAD) into ROOT,
//                                             create the build directories and make it a git repo
//   fs-churn.mjs run ROOT [--duration S] [--seed N] [--build-every S] [--build-files N] [--build-seconds S]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [mode, root, ...rest] = process.argv.slice(2);
if (!mode || !root) {
  console.error("usage: fs-churn.mjs prepare|run ROOT ...");
  process.exit(2);
}

if (mode === "prepare") {
  const source = rest[0] ?? path.resolve(new URL("../..", import.meta.url).pathname);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const archive = execFileSync("git", ["-C", source, "archive", "HEAD"], { maxBuffer: 1 << 30 });
  execFileSync("tar", ["-x", "-C", root], { input: archive });
  for (const dir of ["target/debug/build", "node_modules/.cache", "dist/assets"])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  // Generations that already exist, so the first build has something to replace.
  for (let g = 0; g < 2; g++) writeGeneration(root, g, 40, 0);
  fs.appendFileSync(path.join(root, ".gitignore"), "\n/target\n/node_modules\n");
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=lab", "-c", "user.email=lab@example.invalid", "add", "-A");
  git("-c", "user.name=lab", "-c", "user.email=lab@example.invalid", "commit", "-q", "-m", "fixture");
  console.log(`prepared ${root}`);
  process.exit(0);
}

const options = { duration: 0, seed: 1, "build-every": 45, "build-files": 1500, "build-seconds": 8 };
for (let i = 0; i < rest.length; i += 2) {
  const key = rest[i].replace(/^--/, "");
  if (!(key in options) || rest[i + 1] === undefined) {
    console.error(`unknown or incomplete option ${rest[i]}`);
    process.exit(2);
  }
  options[key] = Number(rest[i + 1]);
}

let seed = (options.seed * 2654435761) >>> 0;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeGeneration(base, generation, files, delayMs) {
  const dirs = Math.max(4, Math.round(files / 25));
  const pending = [];
  for (let i = 0; i < files; i++) {
    const dir = path.join(base, "target/debug/build", `g${generation}`, `pkg-${i % dirs}`);
    const cache = path.join(base, "node_modules/.cache", `g${generation}`, `m-${i % Math.max(2, dirs >> 1)}`);
    pending.push([dir, `out-${i}.o`], [cache, `chunk-${i}.json`]);
  }
  const write = ([dir, name]) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), `${name}\n`.repeat(8 + (generation % 5)));
  };
  if (delayMs === 0) {
    for (const item of pending) write(item);
    return Promise.resolve();
  }
  return (async () => {
    const batch = Math.max(1, Math.floor(pending.length / ((delayMs / 40) | 0 || 1)));
    for (let i = 0; i < pending.length; i += batch) {
      for (const item of pending.slice(i, i + batch)) write(item);
      await sleep(40);
    }
  })();
}

function listFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
function listDirs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    out.push(full);
    listDirs(full, out);
  }
  return out;
}

const sources = listFiles(path.join(root, "src")).filter((file) => /\.(ts|tsx)$/.test(file));
const sourceDirs = [path.join(root, "src"), ...listDirs(path.join(root, "src"))];
// Directories the explorer shows expanded in the lab (scenario driver): only changes directly inside
// a watched directory reach it (target, node_modules and dist are excluded from the native watch).
const hotDirs = ["src", "src/modules", "src/modules/explorer", "src-tauri", "src-tauri/src"].map((dir) => path.join(root, dir));
const hotFiles = hotDirs.flatMap((dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(dir, entry.name)),
);
const hot = () => random() < 0.8;
const started = Date.now();
const done = () => options.duration > 0 && Date.now() - started > options.duration * 1000;
let edits = 0;
let builds = 0;
let scratchCounter = 0;
const scratch = [];

async function agentLoop() {
  while (!done()) {
    await sleep(400 + random() * 2100);
    const roll = random();
    try {
      if (roll < 0.62) {
        const file = hot() ? pick(hotFiles) : pick(sources);
        const text = fs.readFileSync(file, "utf8");
        fs.writeFileSync(file, text.endsWith("\n") ? `${text}// agent edit ${edits}\n` : `${text}\n// agent edit ${edits}\n`);
        edits++;
      } else if (roll < 0.82) {
        const file = path.join(hot() ? pick(hotDirs) : pick(sourceDirs), `agent-scratch-${scratchCounter++}.ts`);
        fs.writeFileSync(file, `export const value = ${scratchCounter};\n`);
        scratch.push({ file, removeAt: Date.now() + 3000 + random() * 15000 });
      } else if (roll < 0.9) {
        const dir = path.join(hot() ? pick(hotDirs) : pick(sourceDirs), `agent-dir-${scratchCounter++}`);
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, "index.ts"), "export {};\n");
        scratch.push({ file: dir, removeAt: Date.now() + 3000 + random() * 15000 });
      } else if (scratch.length > 0) {
        // Rename a scratch file (a refactor moving a file).
        const entry = scratch.find((item) => item.file.endsWith(".ts"));
        if (entry) {
          const next = entry.file.replace(/\.ts$/, `-moved.ts`);
          fs.renameSync(entry.file, next);
          entry.file = next;
        }
      }
    } catch {
      // A file raced away by the cleanup below: the lab does not care.
    }
    const now = Date.now();
    for (let i = scratch.length - 1; i >= 0; i--) {
      if (scratch[i].removeAt > now) continue;
      fs.rmSync(scratch[i].file, { recursive: true, force: true });
      scratch.splice(i, 1);
    }
  }
}

async function buildLoop() {
  let generation = 2;
  while (!done()) {
    await sleep(options["build-every"] * 1000);
    if (done()) break;
    await writeGeneration(root, generation, options["build-files"], options["build-seconds"] * 1000);
    for (let i = 0; i < 40; i++)
      fs.writeFileSync(path.join(root, "dist/assets", `bundle-${i}.js`), `/* build ${generation} */\n`.repeat(40 + i));
    for (const base of ["target/debug/build", "node_modules/.cache"])
      fs.rmSync(path.join(root, base, `g${generation - 2}`), { recursive: true, force: true });
    generation++;
    builds++;
  }
}

await Promise.all([agentLoop(), buildLoop()]);
for (const entry of scratch) fs.rmSync(entry.file, { recursive: true, force: true });
console.log(`churn finished: ${edits} edits, ${builds} builds`);
