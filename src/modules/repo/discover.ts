// src/modules/repo/discover.ts
import { native } from "@/modules/ai/lib/native";
import { join } from "@tauri-apps/api/path";

export type DiscoverOptions = {
  maxDepth?: number;
  maxResults?: number;
  timeoutSecs?: number;
};

export type GitRepo = {
  repoRoot: string;
  name: string;
  type: "root" | "submodule" | "nested";
};

export async function discoverRepositories(
  workspaceRoot: string,
  options: DiscoverOptions = {}
): Promise<GitRepo[]> {
  const {
    maxDepth = 3,
    maxResults = 20,
    timeoutSecs = 0.15,
  } = options;

  const startTime = performance.now();

  // Helper to check if we've exceeded timeout
  const checkTimeout = () => {
    const elapsed = (performance.now() - startTime) / 1000;
    return elapsed > timeoutSecs;
  };

  // Normalize and get realpath of workspace root to prevent symlink escapes
  let realWorkspaceRoot: string;
  try {
    realWorkspaceRoot = await native.canonicalize(workspaceRoot);
  } catch {
    // Fallback to manual normalization if canonicalize fails
    realWorkspaceRoot = workspaceRoot.replace(/\\/g, "/");
  }

  // Set to track unique real paths to prevent duplicates
  const seenRealPaths = new Set<string>();
  const repos: GitRepo[] = [];

  // Always include the workspace root if it's a git repo
  const rootRepoInfo = await native.gitResolveRepo(workspaceRoot);
  if (rootRepoInfo?.repoRoot) {
    try {
      const realRoot = await native.canonicalize(rootRepoInfo.repoRoot);
      if (
        realRoot.startsWith(realWorkspaceRoot) &&
        !seenRealPaths.has(realRoot)
      ) {
        seenRealPaths.add(realRoot);
        repos.push({
          repoRoot: realRoot,
          name: getRepoName(realRoot),
          type: "root",
        });
      }
    } catch {
      // Fallback if canonicalize fails
      const normalizedRoot = rootRepoInfo.repoRoot.replace(/\\/g, "/");
      if (
        normalizedRoot.startsWith(realWorkspaceRoot) &&
        !seenRealPaths.has(normalizedRoot)
      ) {
        seenRealPaths.add(normalizedRoot);
        repos.push({
          repoRoot: normalizedRoot,
          name: getRepoName(normalizedRoot),
          type: "root",
        });
      }
    }
  }

  // If we've already hit timeout or max results, return early
  if (checkTimeout() || repos.length >= maxResults) {
    return repos;
  }

  // Recursive discovery with depth limit
  const discover = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth || checkTimeout() || repos.length >= maxResults) {
      return;
    }

    try {
      const entries = await native.readDir(dir);
      for (const entry of entries) {
        if (checkTimeout() || repos.length >= maxResults) {
          return;
        }

        // Skip if not a directory (we're looking for .git dirs/files)
        if (entry.kind !== "dir" && entry.kind !== "file") {
          continue;
        }

        // Skip hidden directories/files except .git
        if (entry.name.startsWith(".") && entry.name !== ".git") {
          continue;
        }

        const entryPath = await join(dir, entry.name);

        // Check for .git directory
        if (entry.name === ".git" && entry.kind === "dir") {
          try {
            const realPath = await native.canonicalize(entryPath);
            if (
              realPath.startsWith(realWorkspaceRoot) &&
              !seenRealPaths.has(realPath)
            ) {
              seenRealPaths.add(realPath);
              repos.push({
                repoRoot: realPath,
                name: getRepoName(realPath),
                type: depth === 0 ? "root" : "submodule",
              });
            }
          } catch {
            // Skip if we can't canonicalize
          }
          continue; // Don't descend into .git directory
        }

        // Check for .git file (submodule pointer)
        if (entry.name === ".git" && entry.kind === "file") {
          try {
            const gitfileContent = await native.readFile(entryPath);
            if (gitfileContent.kind === "text") {
              // Parse gitdir: <path> format
              const match = gitfileContent.content.match(/^gitdir:\s*(.+)$/m);
              if (match) {
                let gitdirPath = match[1].trim();
                // Handle relative paths
                if (!gitdirPath.startsWith("/")) {
                  gitdirPath = await join(dirname(entryPath), gitdirPath);
                }
                try {
                  const realPath = await native.canonicalize(gitdirPath);
                  if (
                    realPath.startsWith(realWorkspaceRoot) &&
                    !seenRealPaths.has(realPath)
                  ) {
                    seenRealPaths.add(realPath);
                    repos.push({
                      repoRoot: realPath,
                  name: getRepoName(realPath),
                  type: "submodule",
                    });
                  }
                } catch {
                  // Skip if we can't canonicalize
                }
              }
            }
          } catch {
            // Skip if we can't read the .git file
          }
          continue; // Don't descend further from .git file
        }

        // Recurse into subdirectories
        if (entry.kind === "dir") {
          await discover(entryPath, depth + 1);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  };

  // Start discovery from workspace root
  await discover(workspaceRoot, 0);

  // Sort by type (root first) then by name for consistent ordering
  repos.sort((a, b) => {
    const typeOrder = { root: 0, submodule: 1, nested: 2 };
    if (typeOrder[a.type] !== typeOrder[b.type]) {
      return typeOrder[a.type] - typeOrder[b.type];
    }
    return a.name.localeCompare(b.name);
  });

  return repos.slice(0, maxResults);
}

// Helper to get a nice name for a repo
function getRepoName(repoRoot: string): string {
  const baseName = repoRoot.split(/[\\/]/).pop();
  return baseName || repoRoot;
}

// Helper to get dirname
function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  return normalized.slice(0, index);
}