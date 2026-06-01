import type { GitChangedFile, GitStatusSnapshot } from "@/modules/ai/lib/native";

export type GitStatusCode = "M" | "A" | "D" | "U" | "R";

const PRIORITY: Record<GitStatusCode, number> = {
  U: 5,
  D: 4,
  M: 3,
  R: 3,
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
    case "C":
      return "R";
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

function uniqueRoots(roots: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of roots) {
    if (!root) continue;
    const norm = normalizePath(root);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(root);
  }
  return out;
}

export function repoCoversPath(
  repoRoot: string,
  path: string | null,
  alternateRoots: string[] = [],
): boolean {
  if (!path) return false;
  return uniqueRoots([repoRoot, ...alternateRoots]).some((root) => {
    const repo = normalizePath(root);
    const target = normalizePath(path);
    return target === repo || target.startsWith(`${repo}/`);
  });
}

export function repoRelativePath(
  absolutePath: string,
  roots: string[],
): string | null {
  const abs = normalizePath(absolutePath);
  for (const root of uniqueRoots(roots)) {
    const repo = normalizePath(root);
    if (abs === repo) return "";
    if (abs.startsWith(`${repo}/`)) return abs.slice(repo.length + 1);
  }
  return null;
}

export function lookupGitStatus(
  map: Map<string, GitStatusCode>,
  repoRoot: string,
  absolutePath: string,
  alternateRoots: string[] = [],
): GitStatusCode | null {
  const rel = repoRelativePath(absolutePath, [repoRoot, ...alternateRoots]);
  if (rel === null) return null;
  return map.get(rel) ?? null;
}
