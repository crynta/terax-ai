import { quoteShellArg } from "@/lib/shellQuote";
import type { EditorFormatter } from "@/modules/settings/store";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";

type ReadResult = { kind: string; content?: string };

type CommandOutput = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
};

const COMMANDS: Record<Exclude<EditorFormatter, "lsp">, string> = {
  biome: "biome format --write",
  prettier: "prettier --write",
};

function dirname(path: string): string {
  const segs = path.split(/[\\/]/);
  segs.pop();
  return segs.join("/") || "/";
}

/** Returns null on success, an error message otherwise. */
export async function runExternalFormatter(
  formatter: Exclude<EditorFormatter, "lsp">,
  path: string,
): Promise<string | null> {
  try {
    const out = await invoke<CommandOutput>("shell_run_command", {
      command: `${COMMANDS[formatter]} ${quoteShellArg(path)}`,
      cwd: dirname(path),
      timeoutSecs: 20,
      workspace: currentWorkspaceEnv(),
    });
    if (out.timed_out) return `${formatter} timed out`;
    if (out.exit_code !== 0) {
      return out.stderr.trim().slice(-300) || `${formatter} failed`;
    }
    return null;
  } catch (e) {
    return String(e);
  }
}

export async function readFileText(path: string): Promise<string | null> {
  const res = await invoke<ReadResult>("fs_read_file", {
    path,
    workspace: currentWorkspaceEnv(),
  }).catch(() => null);
  return res?.kind === "text" ? (res.content ?? null) : null;
}

// Minimal change dispatch: trimming the common prefix/suffix keeps the
// cursor in place through CodeMirror's position mapping.
export function applyFormattedContent(view: EditorView, next: string): void {
  const current = view.state.doc.toString();
  if (current === next) return;
  let start = 0;
  const minLen = Math.min(current.length, next.length);
  while (start < minLen && current[start] === next[start]) start += 1;
  let endCur = current.length;
  let endNext = next.length;
  while (
    endCur > start &&
    endNext > start &&
    current[endCur - 1] === next[endNext - 1]
  ) {
    endCur -= 1;
    endNext -= 1;
  }
  view.dispatch({
    changes: { from: start, to: endCur, insert: next.slice(start, endNext) },
  });
}
