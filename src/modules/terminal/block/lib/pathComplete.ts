import { escapeForShell, unescapeForShell } from "@/lib/shellQuote";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { type Completion, startCompletion } from "@codemirror/autocomplete";
import { invoke } from "@tauri-apps/api/core";
import { usesWindowsShell } from "./shellSyntax";

type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
};

export type PathResult = { fromOffset: number; options: Completion[] };

function joinRel(cwd: string, rel: string): string {
  const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
  const clean = rel.replace(/\/$/, "");
  return clean ? `${base}/${clean}` : base;
}

function resolveDir(
  dirPart: string,
  cwd: string,
  windows: boolean,
): string | null {
  // Home expansion is not handled yet. Only a typed `~` counts as home; a
  // completed `\~name/` is a real relative name and reaches the join below.
  if (dirPart.startsWith("~")) return null;
  const dir = unescapeForShell(dirPart, windows);
  if (dir.startsWith("/")) return dir || "/";
  return joinRel(cwd, dir);
}

// The label is what accept inserts, so the popup filters against the same text
// the shell word holds (`My\ F` keeps matching `My Folder/`). An escaped name
// still displays unescaped: the list stays readable and typing `My F` matches.
function nameOption(
  display: string,
  insert: string,
  type: Completion["type"],
): Completion {
  return display === insert
    ? { label: insert, type }
    : { label: insert, displayLabel: display, type };
}

// Completes the argument token against the terminal's live cwd. Directories get
// a trailing slash and re-trigger completion so the next level opens on accept.
// Shell syntax is escaped as it is inserted (`My\ Folder`), because the line is
// handed to the shell as typed; what was already typed is unescaped before it
// is matched and read, so a partly typed `My\ Fol` still completes.
export async function pathCompletions(
  token: string,
  cwd: string,
): Promise<PathResult | null> {
  const slash = token.lastIndexOf("/");
  const dirPart = slash >= 0 ? token.slice(0, slash + 1) : "";
  const base = slash >= 0 ? token.slice(slash + 1) : token;
  // A WSL workspace runs a POSIX shell even on a Windows host, so escape the
  // line for the shell the workspace reads, not for the platform.
  const windows = usesWindowsShell();
  const dir = resolveDir(dirPart, cwd, windows);
  if (!dir) return null;

  let entries: DirEntry[];
  try {
    entries = await invoke<DirEntry[]>("fs_read_dir", {
      path: dir,
      showHidden: base.startsWith("."),
      workspace: currentWorkspaceEnv(),
    });
  } catch {
    return null;
  }

  const lower = unescapeForShell(base, windows).toLowerCase();
  const dirs: Completion[] = [];
  const files: Completion[] = [];
  for (const e of entries) {
    if (lower && !e.name.toLowerCase().startsWith(lower)) continue;
    const escaped = escapeForShell(e.name, windows);
    if (e.kind === "dir") {
      const insert = `${escaped}/`;
      dirs.push({
        ...nameOption(`${e.name}/`, insert, "type"),
        apply: (view, _c, from, to) => {
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
          });
          startCompletion(view);
        },
      });
    } else {
      files.push(nameOption(e.name, escaped, "variable"));
    }
    if (dirs.length + files.length >= 200) break;
  }

  return { fromOffset: dirPart.length, options: [...dirs, ...files] };
}
