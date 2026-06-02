import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type { GrepHit, GrepResponse, SearchModifiers } from "./types";

/** Escape regex special characters in a literal string. */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wrap pattern for whole-word matching. */
export function wrapWholeWord(pattern: string): string {
  return `\\b${pattern}\\b`;
}

/** Build the final regex pattern from user input and modifiers. */
export function buildPattern(raw: string, modifiers: SearchModifiers): string {
  let pattern = modifiers.regex ? raw : escapeRegex(raw);
  if (modifiers.wholeWord) {
    pattern = wrapWholeWord(pattern);
  }
  return pattern;
}

/**
 * Execute a project-wide grep search via the existing Rust command.
 * Returns null if pattern is empty.
 */
export async function executeSearch(
  pattern: string,
  root: string | null,
  modifiers: SearchModifiers,
): Promise<GrepResponse | null> {
  if (!pattern.trim() || !root) return null;

  const regexPattern = buildPattern(pattern.trim(), modifiers);

  try {
    const response = await invoke<GrepResponse>("fs_grep", {
      pattern: regexPattern,
      root,
      caseInsensitive: !modifiers.caseSensitive,
      maxResults: 200,
      workspace: currentWorkspaceEnv(),
    });
    return response;
  } catch (err) {
    console.error("[search] fs_grep failed:", err);
    throw err;
  }
}

/** Group hits by file path, preserving insertion order. */
export function groupHitsByFile(
  hits: GrepHit[],
): { path: string; hits: GrepHit[] }[] {
  const map = new Map<string, GrepHit[]>();
  for (const hit of hits) {
    const list = map.get(hit.path);
    if (list) {
      list.push(hit);
    } else {
      map.set(hit.path, [hit]);
    }
  }
  return Array.from(map.entries()).map(([path, fileHits]) => ({
    path,
    hits: fileHits,
  }));
}
