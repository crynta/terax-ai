import { currentWorkspaceEnv } from "@/modules/workspace";
import { type Completion, startCompletion } from "@codemirror/autocomplete";
import { invoke } from "@tauri-apps/api/core";

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

function resolveDir(dirPart: string, cwd: string): string | null {
  if (dirPart.startsWith("~")) return null; // home expansion not handled yet
  if (dirPart.startsWith("/")) return dirPart || "/";
  return joinRel(cwd, dirPart);
}

// Completes the argument token against the terminal's live cwd. Directories get
// a trailing slash and re-trigger completion so the next level opens on accept.
export async function pathCompletions(
  token: string,
  cwd: string,
): Promise<PathResult | null> {
  const slash = token.lastIndexOf("/");
  const dirPart = slash >= 0 ? token.slice(0, slash + 1) : "";
  const base = slash >= 0 ? token.slice(slash + 1) : token;
  const dir = resolveDir(dirPart, cwd);
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

  const lower = base.toLowerCase();
  const dirs: Completion[] = [];
  const files: Completion[] = [];
  for (const e of entries) {
    if (lower && !e.name.toLowerCase().startsWith(lower)) continue;
    const isDir = e.kind === "dir";
    if (isDir) {
      dirs.push({
        label: `${e.name}/`,
        type: "type",
        apply: (view, _c, from, to) => {
          const insert = `${e.name}/`;
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
          });
          startCompletion(view);
        },
      });
    } else {
      files.push({ label: e.name, type: "variable" });
    }
    if (dirs.length + files.length >= 200) break;
  }

  return { fromOffset: dirPart.length, options: [...dirs, ...files] };
}
