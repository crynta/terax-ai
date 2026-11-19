import { escapeForShell, unescapeForShell } from "@/lib/shellQuote";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  startCompletion,
} from "@codemirror/autocomplete";
import { invoke } from "@tauri-apps/api/core";
import { usesWindowsShell } from "./shellSyntax";
import { shellWordAt, type ShellWord } from "./shellWord";

type DirEntry = { name: string; kind: "file" | "dir" | "symlink" };
type PathParts = { directory: string; prefix: string };
export type PathResult = {
  options: Completion[];
  prefix: string;
  update: (token: string) => PathResult | null;
};

function pathParts(token: string, windows: boolean): PathParts | null {
  let path = unescapeForShell(token, windows);
  if (path === null) return null;
  if (windows) path = path.replace(/\\/g, "/");
  const slash = path.lastIndexOf("/");
  return { directory: path.slice(0, slash + 1), prefix: path.slice(slash + 1) };
}

function resolveDir(
  directory: string,
  cwd: string,
  windows: boolean,
): string | null {
  if (windows && /^[a-z]:/i.test(directory)) {
    return /^[a-z]:\//i.test(directory) ? directory : null;
  }
  if (directory.startsWith("/")) return directory;
  return directory ? `${cwd.replace(/\/$/, "")}/${directory}` : cwd;
}

export async function pathCompletions(
  token: string,
  cwd: string,
): Promise<PathResult | null> {
  const workspace = currentWorkspaceEnv();
  const windows = usesWindowsShell();
  const parts = pathParts(token, windows);
  if (!parts) return null;
  const dir = resolveDir(parts.directory, cwd, windows);
  if (!dir) return null;
  let entries: DirEntry[];
  try {
    entries = await invoke<DirEntry[]>("fs_read_dir", {
      path: dir,
      showHidden: parts.prefix.startsWith("."),
      workspace,
    });
  } catch {
    return null;
  }
  if (currentWorkspaceEnv() !== workspace) return null;
  const initialPrefix = parts.prefix.toLowerCase();
  const matches: DirEntry[] = [];
  let truncated = false;
  for (const entry of entries) {
    if (!entry.name.toLowerCase().startsWith(initialPrefix)) continue;
    if (matches.length === 200) {
      truncated = true;
      break;
    }
    matches.push(entry);
  }
  matches.sort((a, b) => Number(b.kind === "dir") - Number(a.kind === "dir"));

  const build = (next: PathParts): PathResult => ({
    prefix: next.prefix,
    options: matches
      .filter((e) => e.name.toLowerCase().startsWith(next.prefix.toLowerCase()))
      .map((e) => {
        const isDir = e.kind === "dir";
        const label = e.name + (isDir ? "/" : "");
        const insert = escapeForShell(next.directory + label, windows);
        return {
          label,
          type: isDir ? "type" : "variable",
          apply: isDir
            ? (view, _completion, from, to) => {
                view.dispatch({
                  changes: { from, to, insert },
                  selection: { anchor: from + insert.length },
                });
                startCompletion(view);
              }
            : insert,
        };
      }),
    update: (nextToken) => {
      const nextParts = pathParts(nextToken, windows);
      if (
        !nextParts ||
        currentWorkspaceEnv() !== workspace ||
        nextParts.directory !== parts.directory ||
        nextParts.prefix.startsWith(".") !== parts.prefix.startsWith(".") ||
        !nextParts.prefix.toLowerCase().startsWith(initialPrefix) ||
        (truncated && nextParts.prefix !== parts.prefix)
      )
        return null;
      return build(nextParts);
    },
  });
  return build(parts);
}

export function pathCompletionResult(
  word: ShellWord,
  paths: PathResult,
  windows: boolean,
  isCurrent: () => boolean = () => true,
): CompletionResult {
  return {
    from: word.start,
    to: word.end,
    options: paths.options,
    filter: false,
    getMatch: () => (paths.prefix ? [0, paths.prefix.length] : []),
    update: (_result, from, _to, ctx: CompletionContext) => {
      const doc = ctx.state.doc.toString();
      const nextWord = shellWordAt(doc, ctx.pos, windows);
      if (
        !isCurrent() ||
        nextWord.start !== from ||
        unescapeForShell(doc.slice(nextWord.start, nextWord.end), windows) ===
          null
      )
        return null;
      const next = paths.update(nextWord.text);
      return next
        ? pathCompletionResult(nextWord, next, windows, isCurrent)
        : null;
    },
  };
}
