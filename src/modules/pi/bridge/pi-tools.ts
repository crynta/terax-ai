/**
 * Pi SDK Webview Bridge — Tool definitions
 *
 * Maps the Pi SDK's tool interface to Tauri IPC calls.
 * These replace the Node.js sidecar's native-tools.js.
 *
 * The tools use the same Tauri commands the original Terax uses
 * (fs_read_file, shell_run_command, etc.) — no new Rust code needed.
 */
import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";

// ─── Tauri response types ───

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
};

type CommandOutput = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
};

type GrepHit = { path: string; rel: string; line: number; text: string };
type GrepResponse = {
  hits: GrepHit[];
  truncated: boolean;
  files_scanned: number;
};
type GlobHit = { path: string; rel: string };
type GlobResponse = { hits: GlobHit[]; truncated: boolean };

// ─── Helpers ───

function ws() {
  return currentWorkspaceEnv();
}

function resolvePath(path: string, cwd: string): string {
  if (path.startsWith("/")) return path;
  // Expand ~ to home directory.
  // On macOS, $HOME is set in the Tauri process. We can derive it
  // from CWD by finding the user home (e.g., /Users/alice).
  if (path.startsWith("~")) {
    const homeDir = deriveHomeDir(cwd);
    return path.replace(/^~/, homeDir);
  }
  return `${cwd}/${path}`.replace(/\/+/g, "/");
}

/**
 * Derive home directory from CWD.
 * On macOS: /Users/alice/projects/foo → /Users/alice
 * On Linux: /home/alice/projects/foo → /home/alice
 */
function deriveHomeDir(cwd: string): string {
  const match = cwd.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
  if (match) return match[1];
  // Fallback: strip trailing path components until we reach a likely home
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length >= 2) return `/${parts.slice(0, 2).join("/")}`;
  return cwd;
}

// ─── Verified execution path ───
//
// Every agent-initiated tool call is routed through the Rust verified executor
// (`pi_agent_tool_execute`). Rust authorizes the cwd against the live workspace
// registry, evaluates capability policy, consumes a user-issued approval grant
// for Ask-level tools, runs the tool, and records an audit entry. The webview
// approval card is UX; Rust is the security boundary.

export type NativeToolContentItem = { type: string; text?: string };
export type NativeToolResult = {
  content: NativeToolContentItem[];
  details?: unknown;
};

/** Run a native agent tool under full Rust enforcement. */
export async function executeAgentTool(req: {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  cwd: string;
  input: unknown;
}): Promise<NativeToolResult> {
  return invoke<NativeToolResult>("pi_agent_tool_execute", {
    request: {
      sessionId: req.sessionId,
      toolCallId: req.toolCallId,
      toolName: req.toolName,
      cwd: req.cwd,
      workspaceEnv: ws(),
      input: req.input,
    },
  });
}

/** Record a single-use approval grant the moment the user approves a tool. */
export async function grantAgentTool(
  sessionId: string,
  toolCallId: string,
  toolName: string,
): Promise<void> {
  await invoke("pi_approval_grant", { sessionId, toolCallId, toolName });
}

// ─── Tool implementations ───

export const piBridgeTools = {
  /**
   * Read a file via Tauri IPC.
   */
  async readFile(path: string, cwd: string) {
    const abs = resolvePath(path, cwd);
    const result = await invoke<ReadResult>("fs_read_file", {
      path: abs,
      workspace: ws(),
    });
    if (result.kind === "binary") {
      return { error: "binary file", path: abs, size: result.size };
    }
    if (result.kind === "toolarge") {
      return { error: `file too large (${result.size} bytes)`, path: abs };
    }
    return { content: result.content, path: abs, size: result.size };
  },

  /**
   * Write a file via Tauri IPC.
   */
  async writeFile(path: string, content: string, cwd: string) {
    const abs = resolvePath(path, cwd);
    await invoke("fs_write_file", {
      path: abs,
      content,
      workspace: ws(),
    });
    return { path: abs, ok: true, bytesWritten: content.length };
  },

  /**
   * Edit a file — read, apply edits in JS, write back.
   */
  async editFile(
    path: string,
    edits: Array<{ oldText: string; newText: string }>,
    cwd: string,
  ) {
    const abs = resolvePath(path, cwd);

    // Read current content
    const result = await invoke<ReadResult>("fs_read_file", {
      path: abs,
      workspace: ws(),
    });
    if (result.kind !== "text") {
      return { error: "cannot read file for editing", path: abs };
    }

    let content = result.content;
    let applied = 0;
    const failed: string[] = [];

    for (const edit of edits) {
      const idx = content.indexOf(edit.oldText);
      if (idx === -1) {
        failed.push(`oldText not found: ${edit.oldText.slice(0, 50)}...`);
        continue;
      }
      // Check uniqueness — if oldText appears multiple times, reject the edit
      // to avoid silently editing the wrong location.
      const secondIdx = content.indexOf(edit.oldText, idx + 1);
      if (secondIdx !== -1) {
        failed.push(
          `oldText is not unique (found at ${idx} and ${secondIdx}): ${edit.oldText.slice(0, 50)}...`,
        );
        continue;
      }
      content =
        content.slice(0, idx) +
        edit.newText +
        content.slice(idx + edit.oldText.length);
      applied++;
    }

    if (applied > 0) {
      await invoke("fs_write_file", {
        path: abs,
        content,
        workspace: ws(),
      });
    }

    return {
      path: abs,
      applied,
      failed: failed.length > 0 ? failed : undefined,
    };
  },

  /**
   * List directory entries.
   */
  async listDirectory(path: string, cwd: string) {
    const abs = resolvePath(path, cwd);
    const entries = await invoke<DirEntry[]>("fs_read_dir", {
      path: abs,
      showHidden: false,
      workspace: ws(),
    });
    return {
      path: abs,
      entries: entries.map((e) => ({ name: e.name, kind: e.kind })),
    };
  },

  /**
   * Grep via ripgrep (Tauri backend).
   */
  async grep(
    pattern: string,
    root: string,
    options?: {
      glob?: string[];
      caseInsensitive?: boolean;
      maxResults?: number;
    },
  ) {
    const abs = resolvePath(root, root.startsWith("/") ? "" : "/");
    const result = await invoke<GrepResponse>("fs_grep", {
      pattern,
      root: abs,
      glob: options?.glob ?? null,
      caseInsensitive: options?.caseInsensitive ?? null,
      maxResults: options?.maxResults ?? null,
      workspace: ws(),
    });
    return result;
  },

  /**
   * Glob pattern search via Tauri.
   */
  async glob(pattern: string, root: string, maxResults?: number) {
    const abs = resolvePath(root, root.startsWith("/") ? "" : "/");
    const result = await invoke<GlobResponse>("fs_glob", {
      pattern,
      root: abs,
      maxResults: maxResults ?? null,
      workspace: ws(),
    });
    return result;
  },

  /**
   * Run a shell command via Tauri.
   */
  async bash(command: string, cwd: string, timeoutSecs?: number) {
    const sessionId = await invoke<number>("shell_session_open", {
      cwd,
      workspace: ws(),
    });
    try {
      const result = await invoke<CommandOutput & { cwd_after: string }>(
        "shell_session_run",
        {
          id: sessionId,
          command,
          cwd,
          timeoutSecs: timeoutSecs ?? 120,
          workspace: ws(),
        },
      );
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exit_code,
        timedOut: result.timed_out,
        truncated: result.truncated,
      };
    } finally {
      await invoke("shell_session_close", { id: sessionId });
    }
  },

  /**
   * Get the canonical (resolved) path.
   */
  async canonicalize(path: string) {
    return invoke<string>("fs_canonicalize", { path, workspace: ws() });
  },
};
