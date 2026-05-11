import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { checkShellCommand } from "../lib/security";
import type { ToolContext } from "./context";

export function buildOpencodeTools(ctx: ToolContext) {
  return {
    opencode_run: tool({
      description:
        "Run an opencode CLI command and return structured output. opencode is an AI coding assistant that can read, write, search code, and run shell commands. Use this to delegate complex coding tasks, code review, refactoring, or investigation to opencode. Auto-executes for read-only prompts; mutating prompts require approval. The command runs in the project's working directory.",
      inputSchema: z.object({
        prompt: z
          .string()
          .describe(
            "The message/prompt to send to opencode. Be specific and self-contained.",
          ),
        model: z
          .string()
          .optional()
          .describe(
            "Model in provider/model format (e.g. 'openai/gpt-5.4-mini'). Uses opencode's default if omitted.",
          ),
        agent: z
          .string()
          .optional()
          .describe(
            "Agent to use (e.g. 'coder', 'architect'). Uses opencode's default if omitted.",
          ),
        files: z
          .array(z.string())
          .optional()
          .describe(
            "File paths to attach to the message (relative to cwd or absolute).",
          ),
        continue_session: z
          .boolean()
          .optional()
          .describe(
            "Continue the last opencode session instead of starting fresh.",
          ),
        session_id: z
          .string()
          .optional()
          .describe("Specific opencode session ID to continue."),
        dir: z
          .string()
          .optional()
          .describe(
            "Working directory for the command. Defaults to the active terminal cwd.",
          ),
      }),
      needsApproval: true,
      execute: async ({
        prompt,
        model,
        agent,
        files,
        continue_session,
        session_id,
        dir,
      }) => {
        const cwd = dir ?? ctx.getCwd();

        const parts: string[] = ["opencode", "run"];

        if (model) {
          parts.push("-m", model);
        }
        if (agent) {
          parts.push("--agent", agent);
        }
        if (continue_session) {
          parts.push("--continue");
        }
        if (session_id) {
          parts.push("--session", session_id);
        }
        if (files && files.length > 0) {
          for (const f of files) {
            parts.push("-f", f);
          }
        }

        parts.push("--format", "json");

        const escapedPrompt = prompt.replace(/"/g, '\\"');
        parts.push(`"${escapedPrompt}"`);

        const command = parts.join(" ");

        const safety = checkShellCommand(command);
        if (!safety.ok) return { error: safety.reason };

        try {
          const r = await native.runCommand(command, cwd, 300);
          return {
            command,
            cwd,
            stdout: r.stdout,
            stderr: r.stderr,
            exit_code: r.exit_code,
            timed_out: r.timed_out,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    opencode_session: tool({
      description:
        "Manage opencode sessions: list, export, or get info about opencode sessions. Auto-executes.",
      inputSchema: z.object({
        action: z
          .enum(["list", "export"])
          .describe(
            "'list' to show all sessions, 'export' to export a specific session as JSON.",
          ),
        session_id: z
          .string()
          .optional()
          .describe(
            "Session ID (required for 'export' action).",
          ),
      }),
      execute: async ({ action, session_id }) => {
        const cwd = ctx.getCwd();

        if (action === "list") {
          try {
            const r = await native.runCommand(
              "opencode session list",
              cwd,
              30,
            );
            return {
              action,
              stdout: r.stdout,
              stderr: r.stderr,
              exit_code: r.exit_code,
            };
          } catch (e) {
            return { error: String(e) };
          }
        }

        if (action === "export") {
          if (!session_id) {
            return { error: "session_id is required for export action" };
          }
          try {
            const r = await native.runCommand(
              `opencode export ${session_id}`,
              cwd,
              30,
            );
            return {
              action,
              session_id,
              stdout: r.stdout,
              stderr: r.stderr,
              exit_code: r.exit_code,
            };
          } catch (e) {
            return { error: String(e) };
          }
        }

        return { error: `unknown action: ${action}` };
      },
    }),
  } as const;
}
