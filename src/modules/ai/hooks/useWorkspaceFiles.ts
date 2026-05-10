import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export function useWorkspaceFiles(workspaceRoot: string | null) {
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    if (!workspaceRoot) return setFiles([]);

    let cancelled = false;
    const load = async () => {
      try {
        const gitignore = await loadGitignore(workspaceRoot);
        const collected = await collectFiles(workspaceRoot, gitignore);
        if (!cancelled) setFiles(collected);
      } catch {
        if (!cancelled) setFiles([]);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [workspaceRoot]);

  return files;
}

async function loadGitignore(root: string): Promise<Set<string>> {
  try {
    const path = root.endsWith("/") ? `${root}.gitignore` : `${root}/.gitignore`;
    const result = await invoke<{ kind: string; content: string }>("fs_read_file", { path });
    if (result.kind !== "text") return new Set();
    
    return new Set(
      result.content
        .split("\n")
        .map(l => l.trim())
        .filter(l => l && !l.startsWith("#"))
    );
  } catch {
    return new Set();
  }
}

async function collectFiles(dir: string, gitignore: Set<string>, base = ""): Promise<string[]> {
  try {
    const entries = await invoke<{ name: string; kind: string }[]>("fs_read_dir", { path: dir });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = base ? `${base}/${entry.name}` : entry.name;
      if (isIgnored(fullPath, gitignore)) continue;

      if (entry.kind === "file") {
        files.push(fullPath);
      } else if (entry.kind === "dir") {
        const childPath = dir.endsWith("/") ? `${dir}${entry.name}` : `${dir}/${entry.name}`;
        files.push(...await collectFiles(childPath, gitignore, fullPath));
      }
    }

    return files;
  } catch {
    return [];
  }
}

function isIgnored(path: string, patterns: Set<string>): boolean {
  const normalized = path.replace(/^\//, "");
  for (const pattern of patterns) {
    const p = pattern.replace(/^\//, "").replace(/\/$/, "");
    if (p.includes("*")) {
      const regex = p.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?\?/g, ".");
      if (new RegExp(regex).test(normalized)) return true;
    } else if (normalized === p || normalized.startsWith(`${p}/`) || normalized.endsWith(`/${p}`)) {
      return true;
    }
  }
  return false;
}
