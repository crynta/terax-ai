/**
 * Node port of the Terax git commands the Reader uses
 * (src-tauri/src/modules/git/operations.rs): repo lookup, context diffs, the
 * Changes panel, full-file versions and per-file revert. Git runs without a
 * shell, with prompts and optional locks off, under a timeout and output cap.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const TIMEOUT_MS = 30_000;
const DEFAULT_CAP = 2 * 1024 * 1024;
const CONTEXT_DIFF_CAP = 64 * 1024;
const FILE_DIFF_CAP = 200 * 1024;
const VERSION_CAP = 2 * 1024 * 1024;
const MAX_PATHS = 200;

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GIT_OPTIONAL_LOCKS: "0",
  GCM_INTERACTIVE: "Never",
  GCM_PROVIDER: "",
  LC_ALL: "C",
};

type GitRun = { code: number; stdout: Buffer; truncated: boolean };

function git(cwd: string, args: string[], cap = DEFAULT_CAP): Promise<GitRun> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      { cwd, env: GIT_ENV, timeout: TIMEOUT_MS, maxBuffer: cap, encoding: "buffer" },
      (error, stdout) => {
        const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "");
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("git is not installed"));
          return;
        }
        const truncated =
          !!error && /maxBuffer/u.test(String((error as Error).message));
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code)
            : error && !truncated
              ? 1
              : 0;
        resolve({ code, stdout: out.subarray(0, cap), truncated });
      },
    );
    child.stdin?.end();
  });
}

const text = (b: Buffer) => b.toString("utf8");

export type RepoInfo = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  isDetached: boolean;
};

/** Folders the Reader may run git in: the VS Code workspace and Claude cwds. */
export type RepoAuthority = (repoRoot: string) => boolean;

export async function resolveRepo(cwd: string): Promise<RepoInfo | null> {
  const top = await git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => null);
  if (!top || top.code !== 0) return null;
  const repoRoot = await fs.realpath(text(top.stdout).trim()).catch(() => null);
  if (!repoRoot) return null;
  let branch = text((await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout).trim();
  if (!branch) {
    branch = text((await git(repoRoot, ["symbolic-ref", "--short", "HEAD"])).stdout).trim();
  }
  const up = await git(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const upstream = up.code === 0 ? text(up.stdout).trim() || null : null;
  return { repoRoot, branch, upstream, isDetached: branch === "HEAD" };
}

async function checkedRoot(repoRoot: string, allowed: RepoAuthority): Promise<string> {
  const root = await fs.realpath(repoRoot).catch(() => null);
  if (!root || !allowed(root)) throw new Error("path is outside the workspace");
  return root;
}

/** Repo-relative pathspec for `rel`, or null when it could escape the repo. */
export async function revertTarget(root: string, rel: string): Promise<string | null> {
  if (!rel || path.isAbsolute(rel) || rel.startsWith("-")) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters
  if (/[:\u0000-\u001f]/u.test(rel)) return null;
  const parts = rel.split(/[\\/]/u);
  if (parts.some((p) => p === "." || p === "..")) return null;
  let probe = path.join(root, rel);
  let real: string | null = null;
  let suffix = "";
  while (real === null) {
    real = await fs.realpath(probe).catch(() => null);
    if (real !== null) break;
    const parent = path.dirname(probe);
    if (parent === probe) return null;
    suffix = path.join(path.basename(probe), suffix);
    probe = parent;
  }
  const full = suffix ? path.join(real, suffix) : real;
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return path.relative(root, full).split(path.sep).join("/");
}

export async function contextDiff(
  repoRoot: string,
  kind: string,
  allowed: RepoAuthority,
): Promise<{ diffText: string; truncated: boolean }> {
  const root = await checkedRoot(repoRoot, allowed);
  let args: string[];
  if (kind === "working") args = ["diff", "--no-ext-diff", "HEAD"];
  else if (kind === "branch") {
    let base: string | null = null;
    const head = await git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    if (head.code === 0 && text(head.stdout).trim()) base = text(head.stdout).trim();
    for (const name of ["main", "master"]) {
      if (base) break;
      const v = await git(root, ["rev-parse", "--verify", "--quiet", name]);
      if (v.code === 0) base = name;
    }
    if (!base) throw new Error("no default branch (main/master) to compare against");
    args = ["diff", "--no-ext-diff", `${base}...HEAD`];
  } else throw new Error("unknown diff kind");
  const run = await git(root, args, CONTEXT_DIFF_CAP);
  if (!run.truncated && run.code !== 0) throw new Error("git diff failed");
  return { diffText: text(run.stdout), truncated: run.truncated };
}

export type HeadFileChange = {
  path: string;
  inHead: boolean;
  added: number;
  removed: number;
  binary: boolean;
  diffText: string;
  truncated: boolean;
};

async function inHead(root: string, spec: string): Promise<boolean> {
  return (await git(root, ["cat-file", "-e", `HEAD:${spec}`])).code === 0;
}

export async function headFileChanges(
  repoRoot: string,
  paths: string[],
  allowed: RepoAuthority,
): Promise<HeadFileChange[]> {
  const root = await checkedRoot(repoRoot, allowed);
  const out: HeadFileChange[] = [];
  for (const rel of paths.slice(0, MAX_PATHS)) {
    const spec = await revertTarget(root, rel);
    if (!spec) continue;
    if (!(await inHead(root, spec))) {
      const body = await fs.readFile(path.join(root, spec), "utf8").catch(() => "");
      const added = body ? body.split("\n").length - (body.endsWith("\n") ? 1 : 0) : 0;
      out.push({ path: rel, inHead: false, added, removed: 0, binary: false, diffText: "", truncated: false });
      continue;
    }
    const num = text((await git(root, ["diff", "--no-ext-diff", "--numstat", "HEAD", "--", spec])).stdout);
    const [a = "0", r = "0"] = (num.split("\n")[0] ?? "").split("\t");
    const binary = a === "-" && r === "-";
    const diff = await git(root, ["diff", "--no-ext-diff", "HEAD", "--", spec], FILE_DIFF_CAP);
    out.push({
      path: rel,
      inHead: true,
      added: binary ? 0 : Number.parseInt(a, 10) || 0,
      removed: binary ? 0 : Number.parseInt(r, 10) || 0,
      binary,
      diffText: text(diff.stdout),
      truncated: diff.truncated,
    });
  }
  return out;
}

const looksBinary = (b: Buffer) => b.subarray(0, 8192).includes(0);

export async function fileVersions(
  repoRoot: string,
  rel: string,
  allowed: RepoAuthority,
): Promise<{ head: string | null; working: string | null; binary: boolean }> {
  const root = await checkedRoot(repoRoot, allowed);
  const spec = await revertTarget(root, rel);
  if (!spec) throw new Error("invalid path");
  let binary = false;
  const shown = await git(root, ["show", "--no-textconv", `HEAD:${spec}`], VERSION_CAP);
  let head: string | null = shown.code === 0 ? text(shown.stdout) : null;
  if (shown.code === 0 && looksBinary(shown.stdout)) {
    binary = true;
    head = null;
  }
  let working: string | null = null;
  const abs = path.join(root, spec);
  const st = await fs.lstat(abs).catch(() => null);
  if (st?.isSymbolicLink()) throw new Error("refusing to follow a symlink");
  if (st?.isFile()) {
    if (st.size > VERSION_CAP) throw new Error("file is too large");
    const buf = await fs.readFile(abs);
    if (looksBinary(buf)) binary = true;
    else working = text(buf);
  }
  return { head, working, binary };
}

export async function revertFile(
  repoRoot: string,
  rel: string,
  deleteNew: boolean,
  allowed: RepoAuthority,
): Promise<"restored" | "deleted"> {
  const root = await checkedRoot(repoRoot, allowed);
  const spec = await revertTarget(root, rel);
  if (!spec) throw new Error("invalid path");
  if (await inHead(root, spec)) {
    const run = await git(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", spec]);
    if (run.code !== 0) throw new Error("git restore failed");
    return "restored";
  }
  if (!deleteNew) throw new Error("the file is new since HEAD; confirm deleting it");
  await git(root, ["rm", "--cached", "--quiet", "--ignore-unmatch", "--", spec]);
  const abs = path.join(root, spec);
  const st = await fs.lstat(abs).catch(() => null);
  if (st?.isDirectory()) throw new Error("invalid path");
  if (st) await fs.unlink(abs);
  return "deleted";
}
