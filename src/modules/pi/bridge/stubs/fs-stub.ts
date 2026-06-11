// Stub for node:fs and node:fs/promises.
// The Pi SDK's tool implementations use these for file I/O.
// In the browser, we override the tools to use Tauri IPC instead.
// This stub exists so imports resolve — it should never be called at runtime.

export function readFile(..._args: unknown[]) {
  throw new Error(
    "fs.readFile not available in browser — use Tauri bridge tools",
  );
}
export function writeFile(..._args: unknown[]) {
  throw new Error(
    "fs.writeFile not available in browser — use Tauri bridge tools",
  );
}
export function readdir(..._args: unknown[]) {
  throw new Error(
    "fs.readdir not available in browser — use Tauri bridge tools",
  );
}
export function stat(..._args: unknown[]) {
  throw new Error("fs.stat not available in browser — use Tauri bridge tools");
}
export function mkdir(..._args: unknown[]) {
  throw new Error("fs.mkdir not available in browser — use Tauri bridge tools");
}
export function rm(..._args: unknown[]) {
  throw new Error("fs.rm not available in browser — use Tauri bridge tools");
}
export function access(..._args: unknown[]) {
  throw new Error(
    "fs.access not available in browser — use Tauri bridge tools",
  );
}
export function appendFile(..._args: unknown[]) {
  throw new Error(
    "fs.appendFile not available in browser — use Tauri bridge tools",
  );
}
export function realpath(..._args: unknown[]) {
  throw new Error(
    "fs.realpath not available in browser — use Tauri bridge tools",
  );
}
export function lstat(..._args: unknown[]) {
  throw new Error("fs.lstat not available in browser — use Tauri bridge tools");
}
export function mkdtemp(..._args: unknown[]) {
  throw new Error(
    "fs.mkdtemp not available in browser — use Tauri bridge tools",
  );
}
export function open(..._args: unknown[]) {
  throw new Error("fs.open not available in browser — use Tauri bridge tools");
}
export function close(..._args: unknown[]) {
  throw new Error("fs.close not available in browser — use Tauri bridge tools");
}
export function read(..._args: unknown[]) {
  throw new Error("fs.read not available in browser — use Tauri bridge tools");
}
export function existsSync(..._args: unknown[]) {
  return false;
}
export function readFileSync(..._args: unknown[]) {
  throw new Error("fs.readFileSync not available in browser");
}
export function writeFileSync(..._args: unknown[]) {
  throw new Error("fs.writeFileSync not available in browser");
}
export function appendFileSync(..._args: unknown[]) {
  throw new Error("fs.appendFileSync not available in browser");
}
export function mkdirSync(..._args: unknown[]) {
  throw new Error("fs.mkdirSync not available in browser");
}
export function readdirSync(..._args: unknown[]) {
  throw new Error("fs.readdirSync not available in browser");
}
export function statSync(..._args: unknown[]) {
  throw new Error("fs.statSync not available in browser");
}
export function openSync(..._args: unknown[]) {
  throw new Error("fs.openSync not available in browser");
}
export function closeSync(..._args: unknown[]) {
  throw new Error("fs.closeSync not available in browser");
}
export function readSync(..._args: unknown[]) {
  throw new Error("fs.readSync not available in browser");
}
export function createReadStream(..._args: unknown[]) {
  throw new Error("fs.createReadStream not available in browser");
}
export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
};
export const promises = {
  readFile,
  writeFile,
  readdir,
  stat,
  mkdir,
  rm,
  access,
  appendFile,
  realpath,
  lstat,
  mkdtemp,
};
