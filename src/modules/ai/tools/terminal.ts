import { tool } from "ai";
import { z } from "zod";
import { checkShellCommand } from "../lib/security";
import type { ToolContext } from "./context";

export function buildTerminalTools(ctx: ToolContext) {
  return {
    suggest_command: tool({
      description:
        "Type a single shell command into the user's active terminal at the prompt — WITHOUT executing it. Use this when the answer to the user's question IS a command (e.g. 'ffmpeg one-liner for X', 'git command to undo Y'). Prefer this over prose. Do NOT include a trailing newline.",
      inputSchema: z.object({
        command: z.string().describe("The shell command. No trailing newline."),
        explanation: z
          .string()
          .optional()
          .describe(
            "Optional one-line note shown alongside in the chat log (not in the terminal).",
          ),
      }),
      execute: async ({ command, explanation }) => {
        const safety = checkShellCommand(command);
        if (!safety.ok) return { error: safety.reason };
        const trimmed = command.replace(/\n+$/, "");
        const ok = ctx.injectIntoActivePty(trimmed);
        if (!ok)
          return {
            error: "no active terminal to inject into",
            command: trimmed,
          };
        return { command: trimmed, explanation, injected: true };
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
