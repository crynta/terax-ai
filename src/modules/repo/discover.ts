// src/modules/repo/discover.ts
import { native } from "@/modules/ai/lib/native";

export type DiscoverOptions = {
  maxDepth?: number;
  maxResults?: number;
  timeoutMs?: number;
};

export type GitRepo = {
  repoRoot: string;
  name: string;
  type: "root" | "submodule" | "nested";
};

/**
 * Discovers git repositories in the workspace root.
 *
 * Delegates to a single bounded Rust command (`git_discover_repos`) which:
 * - Can see dot-prefixed entries (including .git) because Rust reads all entries
 * - Performs safe path-component boundary checks (not string startsWith)
 * - Skips symlinks to prevent workspace escape
 * - Handles WSL paths correctly via resolve_path
 * - Respects a cooperative timeout for large workspaces
 */
export async function discoverRepositories(
  workspaceRoot: string,
  options: DiscoverOptions = {},
): Promise<GitRepo[]> {
  try {
    const result = await native.discoverRepos(workspaceRoot, {
      maxDepth: options.maxDepth,
      maxResults: options.maxResults,
      timeoutMs: options.timeoutMs,
    });

    return result.repos.map((repo) => ({
      repoRoot: repo.repoRoot,
      name: repo.name,
      type: repo.type,
    }));
  } catch {
    // If discovery fails entirely, return empty array
    return [];
  }
}
