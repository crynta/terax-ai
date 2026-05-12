import { tool } from "ai";
import { z } from "zod";
import { checkShellCommand } from "../lib/security";
import type { ToolContext } from "./context";

export function buildTerminalTools(ctx: ToolContext) {
  return {
    suggest_command: tool({
      description:
        "Propose a single shell command. Renders a card in chat with an 'Insert' button — the command is NOT written to any terminal automatically; only the user's click inserts it at the prompt without executing. Use this when the answer IS a command.",
      inputSchema: z.object({
        command: z
          .string()
          .describe("The shell command. Single line, no trailing newline."),
        explanation: z
          .string()
          .optional()
          .describe("Optional one-line note shown beside the command."),
      }),
      execute: async ({ command, explanation }) => {
        const safety = checkShellCommand(command);
        if (!safety.ok) return { error: safety.reason };
        // Reject control bytes — the user inserts via click, but the rendered
        // command must reflect exactly what will land at the prompt.
        if (/[\n\r\x00\x1b\x07]/.test(command)) {
          return { error: "command must be a single line without control bytes" };
        }
        return { command, explanation };
      },
    }),

    open_preview: tool({
      description:
        "Open a preview tab (in-app iframe) at the given URL. Use this after starting a dev server (e.g. `pnpm dev`, `npm run dev`) to surface the rendered page next to the terminal. Localhost URLs work best; arbitrary external sites may be blocked by X-Frame-Options.",
      inputSchema: z.object({
        url: z
          .url()
          .describe(
            "Full URL to load (e.g. http://localhost:5173). Must include scheme.",
          ),
      }),
      execute: async ({ url }) => {
        const ok = ctx.openPreview(url);
        if (!ok) return { error: "preview surface unavailable", url };
        return { url, ok: true };
      },
    }),

  } as const;
}
