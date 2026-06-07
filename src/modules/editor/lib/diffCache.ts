import {
  native,
  type GitDiffContentResult,
} from "@/modules/ai/lib/native";
import { currentWorkspaceScopeKey } from "@/modules/workspace";

const DIFF_CACHE_LIMIT = 6;
const inflight = new Map<string, Promise<GitDiffContentResult>>();
const cache = new Map<string, GitDiffContentResult>();

function touch(key: string, value: GitDiffContentResult) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > DIFF_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function getCachedDiff(key: string): GitDiffContentResult | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

export function invalidateDiff(key: string): void {
  cache.delete(key);
}

export function invalidateRepoDiffs(repoRoot: string): void {
  const prefix = `${currentWorkspaceScopeKey()}|${repoRoot}|`;
  for (const k of [...cache.keys()]) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

export function workingDiffKey(
  repoRoot: string,
  path: string,
  mode: "-" | "+",
): string {
  return `${currentWorkspaceScopeKey()}|${repoRoot}|w|${mode}|${path}`;
}

export function commitDiffKey(
  repoRoot: string,
  sha: string,
  path: string,
): string {
  return `${currentWorkspaceScopeKey()}|${repoRoot}|c|${sha}|${path}`;
}

export async function fetchWorkingDiff(
  repoRoot: string,
  path: string,
  mode: "-" | "+",
  originalPath: string | null,
): Promise<GitDiffContentResult> {
  const key = workingDiffKey(repoRoot, path, mode);
  const cached = getCachedDiff(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = native
    .gitDiffContent(repoRoot, path, mode === "+", originalPath)
    .then((res) => {
      touch(key, res);
      return res;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

export async function fetchCommitDiff(
  repoRoot: string,
  sha: string,
  path: string,
  originalPath: string | null,
): Promise<GitDiffContentResult> {
  const key = commitDiffKey(repoRoot, sha, path);
  const cached = getCachedDiff(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = native
    .gitCommitFileDiff(repoRoot, sha, path, originalPath)
    .then((res) => {
      touch(key, res);
      return res;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}
