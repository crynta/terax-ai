import type { GitChangedFile, GitStatusSnapshot } from "@/modules/ai/lib/native";

export type GitStatusCode = "M" | "A" | "D" | "U";

const PRIORITY: Record<GitStatusCode, number> = {
  U: 5,
  D: 4,
  M: 3,
  A: 2,
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function normalizeStatusCode(status: string): GitStatusCode {
  const code = status.trim().toUpperCase();
  switch (code) {
    case "?":
      return "U";
    case "A":
      return "A";
    case "M":
      return "M";
    case "D":
      return "D";
    case "R":
      return "M";
    case "C":
      return "A";
    case "U":
      return "U";
    default:
      return "M";
  }
}

export function statusCodeForFile(file: GitChangedFile): GitStatusCode {
  if (file.untracked) return "U";
  if (file.indexStatus === "U" || file.worktreeStatus === "U") return "U";

  const primary = file.unstaged ? file.worktreeStatus : file.indexStatus;
  const fallback = file.unstaged ? file.indexStatus : file.worktreeStatus;
  return normalizeStatusCode(primary !== " " ? primary : fallback);
}

export function buildGitStatusMap(
  status: GitStatusSnapshot,
): Map<string, GitStatusCode> {
  const map = new Map<string, GitStatusCode>();
  for (const file of status.changedFiles) {
    map.set(file.path, statusCodeForFile(file));
  }
  return map;
}

function parentSegments(relPath: string): string[] {
  const parts = relPath.split("/").filter(Boolean);
  parts.pop();
  const parents: string[] = [];
  for (let i = parts.length; i > 0; i--) {
    parents.push(parts.slice(0, i).join("/"));
  }
  return parents;
}

export function bubbleUpDirectoryStatuses(
  map: Map<string, GitStatusCode>,
): void {
  for (const [path, code] of [...map.entries()]) {
    for (const parent of parentSegments(path)) {
      const existing = map.get(parent);
      if (!existing || PRIORITY[code] > PRIORITY[existing]) {
        map.set(parent, code);
      }
    }
  }
}

export function repoCoversPath(
  repoRoot: string,
  path: string | null,
): boolean {
  if (!path) return false;
  const repo = normalizePath(repoRoot);
  const target = normalizePath(path);
  return target === repo || target.startsWith(`${repo}/`);
}

export function repoRelativePath(
  repoRoot: string,
  absolutePath: string,
): string | null {
  const repo = normalizePath(repoRoot);
  const abs = normalizePath(absolutePath);
  if (abs === repo) return "";
  if (abs.startsWith(`${repo}/`)) return abs.slice(repo.length + 1);
  return null;
}

export function lookupGitStatus(
  map: Map<string, GitStatusCode>,
  repoRoot: string,
  absolutePath: string,
): GitStatusCode | null {
  const rel = repoRelativePath(repoRoot, absolutePath);
  if (rel === null) return null;
  return map.get(rel) ?? null;
}
