import { tool } from "ai";
import { z } from "zod";
import { checkShellCommand } from "../lib/security";
import {
  redactTerminalInventory,
  resolveTerminalTarget,
} from "../lib/terminalInventory";
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

    get_terminal_output: tool({
      description:
        "Return the tail of a terminal's scrollback. Use this when the user references 'this error', 'the last command', or you need to interpret recent terminal output. If `tabId` or `leafId` is omitted, it reads the active terminal tab. Returns an empty string if the selected terminal has no buffer; refuses if the selected terminal is in Privacy mode.",
      inputSchema: z.object({
        tabId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Terminal tab id to read. Defaults to the active terminal tab."),
        leafId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Specific terminal leaf id to read. Takes precedence over tabId."),
        lines: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe("Number of trailing lines to return. Default 80."),
      }),
      execute: async ({ tabId, leafId, lines }) => {
        const inventory = ctx.getTerminalInventory();
        const target = resolveTerminalTarget(inventory, { tabId, leafId });
        if (!target.ok) return { error: target.error };
        if (target.target.tab.private) {
          return {
            error:
              `terminal tab ${target.target.tab.tabId} is in Privacy mode; its buffer is withheld. Ask the user to switch to a regular tab if they want you to see it.`,
          };
        }
        const buffer = ctx.readLeafBuffer(target.target.leafId);
        if (!buffer) {
          return {
            output: "",
            note: `no buffer for terminal leaf ${target.target.leafId}`,
            terminal: target.target,
          };
        }
        const n = lines ?? 80;
        const parts = buffer.split("\n");
        const sliced = parts.length <= n ? buffer : parts.slice(parts.length - n).join("\n");
        const MAX = 24_000;
        const capped =
          sliced.length > MAX ? `…[truncated]…\n${sliced.slice(sliced.length - MAX)}` : sliced;
        return {
          output: capped,
          lines_returned: Math.min(parts.length, n),
          terminal: target.target,
        };
      },
    }),

    list_terminals: tool({
      description:
        "List all open terminal tabs and panes, including which terminal tab is active in the app. Use this before reading a specific terminal if the user mentions a tab by title or if multiple terminals are open.",
      inputSchema: z.object({}),
      execute: async () => {
        const inventory = redactTerminalInventory(ctx.getTerminalInventory());
        return inventory;
      },
    }),

    open_preview: tool({
      description:
        "Open a preview tab (in-app iframe) at the given URL — restricted to localhost/loopback addresses for the local dev server. Use this after starting a dev server (e.g. `pnpm dev`, `npm run dev`) to surface the rendered page next to the terminal. To preview external sites, the user should paste the URL into the preview address bar themselves.",
      inputSchema: z.object({
        url: z
          .url()
          .describe(
            "Full URL to load (e.g. http://localhost:5173). Must include scheme. Only http/https on loopback hosts are accepted.",
          ),
      }),
      execute: async ({ url }) => {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return { error: "invalid URL", url };
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return { error: "only http/https URLs are allowed", url };
        }
        const host = parsed.hostname;
        const isLocal =
          host === "localhost" ||
          host === "127.0.0.1" ||
          host === "0.0.0.0" ||
          host === "[::1]" ||
          host === "::1" ||
          host.endsWith(".localhost");
        if (!isLocal) {
          return {
            error:
              "open_preview is restricted to localhost URLs. Ask the user to paste the external URL into the preview address bar instead.",
            url,
          };
        }
        const ok = ctx.openPreview(url);
        if (!ok) return { error: "preview surface unavailable", url };
        return { url, ok: true };
      },
    }),

  } as const;
}
