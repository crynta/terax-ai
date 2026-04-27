import { tool } from "ai";
import { z } from "zod";
import { native } from "./native";
import {
  checkReadable,
  checkShellCommand,
  checkWritable,
} from "./security";

/**
 * AI tool definitions.
 *
 * Approval policy:
 *  - Read-only tools (`read_file`, `list_directory`, `get_terminal_context`)
 *    auto-execute, but go through the security guard which refuses obvious
 *    secret paths (.env*, .ssh/, credentials, etc.).
 *  - Mutating tools (`write_file`, `create_directory`, `run_command`)
 *    require explicit user approval — the AI SDK pauses on tool-call and
 *    surfaces a `tool-approval-request` part that the UI renders as a
 *    confirmation card.
 *
 * The model sees absolute paths only after they are resolved against the
 * active terminal's cwd (provided via `getCwd`); it should not invent paths
 * outside that.
 */

export type ToolContext = {
  /** Active terminal tab cwd, used to resolve relative paths. Null = home. */
  getCwd: () => string | null;
  /** Last N lines of the active terminal buffer (or null if not a terminal tab). */
  getTerminalContext: () => string | null;
};

function resolvePath(rawPath: string, cwd: string | null): string {
  if (rawPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(rawPath)) return rawPath;
  if (!cwd) throw new Error("relative path requires an active terminal cwd");
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  return cwd.endsWith(sep) ? `${cwd}${rawPath}` : `${cwd}${sep}${rawPath}`;
}

export function buildTools(ctx: ToolContext) {
  return {
    read_file: tool({
      description:
        "Read a UTF-8 text file. Returns content for text files; refuses binary, oversized, or sensitive files (.env, keys, credentials).",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute path, or relative to the active terminal cwd."),
      }),
      execute: async ({ path }) => {
        const abs = resolvePath(path, ctx.getCwd());
        const safety = checkReadable(abs);
        if (!safety.ok) return { error: safety.reason, path: abs };
        try {
          const r = await native.readFile(abs);
          if (r.kind === "text") return { path: abs, content: r.content, size: r.size };
          if (r.kind === "binary")
            return { error: "binary file refused", path: abs, size: r.size };
          return {
            error: `file too large (${r.size} bytes, limit ${r.limit})`,
            path: abs,
          };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    list_directory: tool({
      description:
        "List immediate entries (files + directories) in a directory. Hidden entries are omitted.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute path, or relative to the active terminal cwd."),
      }),
      execute: async ({ path }) => {
        const abs = resolvePath(path, ctx.getCwd());
        const safety = checkReadable(abs);
        if (!safety.ok) return { error: safety.reason, path: abs };
        try {
          const entries = await native.readDir(abs);
          return {
            path: abs,
            entries: entries.map((e) => ({ name: e.name, kind: e.kind })),
          };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    get_terminal_context: tool({
      description:
        "Return the recent visible buffer of the active terminal (last few hundred lines). Use this to understand commands the user just ran and their output.",
      inputSchema: z.object({}),
      execute: async () => {
        const ctxText = ctx.getTerminalContext();
        if (!ctxText) return { error: "no active terminal" };
        return { content: ctxText };
      },
    }),

    write_file: tool({
      description:
        "Create or overwrite a file with the given content. Always asks the user before running.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      needsApproval: true,
      execute: async ({ path, content }) => {
        const abs = resolvePath(path, ctx.getCwd());
        const safety = checkWritable(abs);
        if (!safety.ok) return { error: safety.reason, path: abs };
        try {
          await native.writeFile(abs, content);
          return { path: abs, bytesWritten: content.length, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    create_directory: tool({
      description:
        "Create a directory (and any missing parents). Always asks the user before running.",
      inputSchema: z.object({
        path: z.string(),
      }),
      needsApproval: true,
      execute: async ({ path }) => {
        const abs = resolvePath(path, ctx.getCwd());
        const safety = checkWritable(abs);
        if (!safety.ok) return { error: safety.reason, path: abs };
        try {
          await native.createDir(abs);
          return { path: abs, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    run_command: tool({
      description:
        "Run a shell command in a one-shot subshell (NOT in the user's interactive terminal). Returns stdout, stderr, and exit code. Always asks the user before running.",
      inputSchema: z.object({
        command: z.string().describe("The shell command to execute."),
        cwd: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Working directory. If omitted, uses the active terminal's cwd.",
          ),
        timeout_secs: z
          .number()
          .int()
          .min(1)
          .max(300)
          .optional()
          .describe("Hard cap on run time in seconds (default 30, max 300)."),
      }),
      needsApproval: true,
      execute: async ({ command, cwd, timeout_secs }) => {
        const safety = checkShellCommand(command);
        if (!safety.ok) return { error: safety.reason };
        const effectiveCwd = cwd ?? ctx.getCwd();
        try {
          const r = await native.runCommand(
            command,
            effectiveCwd,
            timeout_secs,
          );
          return {
            command,
            cwd: effectiveCwd,
            stdout: r.stdout,
            stderr: r.stderr,
            exit_code: r.exit_code,
            timed_out: r.timed_out,
            truncated: r.truncated,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}

export type ChatTools = ReturnType<typeof buildTools>;
