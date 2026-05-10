import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { checkShellCommand } from "../lib/security";
import type { ToolContext } from "./context";

const sessionShells = new Map<string, Promise<number>>();

async function getSessionShell(sessionId: string, cwd: string | null): Promise<number> {
  let p = sessionShells.get(sessionId);
  if (!p) {
    p = native.shellSessionOpen(cwd);
    sessionShells.set(sessionId, p);
  }
  return p;
}

async function agentBrowserRun(
  sessionId: string,
  cwd: string | null,
  args: string,
  timeout?: number,
): Promise<Record<string, unknown>> {
  const cmd = `agent-browser ${args} --json 2>/dev/null`;
  const safety = checkShellCommand(cmd);
  if (!safety.ok) return { error: safety.reason };
  const shellId = await getSessionShell(sessionId, cwd);
  const r = await native.shellSessionRun(shellId, cmd, null, timeout ?? 30);
  if (r.exit_code !== 0) {
    return { error: r.stderr || r.stdout, exit_code: r.exit_code };
  }
  try {
    return JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    return { raw: r.stdout, stderr: r.stderr };
  }
}

export function buildAgentBrowserTools(ctx: ToolContext) {
  return {
    browser_open: tool({
      description:
        "Open a URL in the stealth browser. Launches agent-browser daemon if not running. Use for web app recon, login flows, exploiting XSS/CSRF/auth bypass, and OSINT. The browser is real Chrome via CDP — not Playwright, not detectable as a bot.",
      inputSchema: z.object({
        url: z.string(),
        proxy: z.string().optional().describe("Route through proxy e.g. http://127.0.0.1:8080"),
        ignore_https_errors: z.boolean().optional().describe("Ignore TLS cert errors — always true for pentesting"),
        headless: z.boolean().optional().describe("Default true. Set false to show browser window."),
        session: z.string().optional().describe("Isolate sessions for multi-user testing"),
      }),
      execute: async ({ url, proxy, ignore_https_errors, headless, session }) => {
        const flags = [
          proxy ? `--proxy ${proxy}` : "",
          ignore_https_errors !== false ? "--ignore-https-errors" : "",
          headless === false ? "--headed" : "",
          session ? `--session ${session}` : "",
        ].filter(Boolean).join(" ");
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        return agentBrowserRun(sid, ctx.getCwd(), `${flags} open ${url}`, 30);
      },
    }),

    browser_snapshot: tool({
      description:
        "Snapshot the current page and return the accessibility tree with `@e1`, `@e2` refs for all interactive elements. Use this to discover clickable elements, forms, inputs, and links after navigating. Refs are stable and can be used with browser_interact.",
      inputSchema: z.object({
        interactive_only: z.boolean().optional().describe("Only return interactive elements (default true)"),
      }),
      execute: async ({ interactive_only }) => {
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        const flags = interactive_only !== false ? "-i" : "";
        return agentBrowserRun(sid, ctx.getCwd(), `snapshot ${flags}`, 15);
      },
    }),

    browser_interact: tool({
      description:
        "Interact with a page element by its `@e1` ref from browser_snapshot. Actions: click, fill (type into input), type (send key events), press (keyboard shortcut), hover, check (checkbox/radio). Use refs from snapshot output.",
      inputSchema: z.object({
        action: z.enum(["click", "fill", "type", "press", "hover", "check"]),
        ref: z.string().describe("Element ref from snapshot e.g. @e1, @e3"),
        value: z.string().optional().describe("Text for fill/type, key for press"),
      }),
      execute: async ({ action, ref, value }) => {
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        const val = value ? ` ${value}` : "";
        return agentBrowserRun(sid, ctx.getCwd(), `${action} ${ref}${val}`, 10);
      },
    }),

    browser_eval: tool({
      description:
        "Execute arbitrary JavaScript in the page context. Use for: extracting tokens/cookies/localStorage, verifying XSS execution, reading DOM state, triggering client-side logic. Pipes the JS return value back.",
      inputSchema: z.object({
        js: z.string().describe("JavaScript expression to evaluate in the browser context"),
      }),
      execute: async ({ js }) => {
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        return agentBrowserRun(sid, ctx.getCwd(), `eval ${JSON.stringify(js)}`, 15);
      },
    }),

    browser_network: tool({
      description:
        "Return all captured network requests/responses from the active browser session. Use after navigating to inspect API calls, auth tokens in headers, and sensitive data in responses. Captures method, URL, status, headers, and body.",
      inputSchema: z.object({}),
      execute: async () => {
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        return agentBrowserRun(sid, ctx.getCwd(), "network requests", 10);
      },
    }),

    browser_cookies: tool({
      description:
        "Get all cookies from the active browser session. Returns name, value, domain, path, expiry for each cookie. Use for session hijacking, cookie analysis, and auth state manipulation.",
      inputSchema: z.object({}),
      execute: async () => {
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        return agentBrowserRun(sid, ctx.getCwd(), "cookies", 10);
      },
    }),

    browser_screenshot: tool({
      description:
        "Take a screenshot of the current page. Returns a local file path to the screenshot image. Use for visual confirmation of exploit results or page state.",
      inputSchema: z.object({}),
      execute: async () => {
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        return agentBrowserRun(sid, ctx.getCwd(), "screenshot", 15);
      },
    }),

    browser_close: tool({
      description:
        "Close all browser sessions and the agent-browser daemon. Call when done with browser work to free resources.",
      inputSchema: z.object({}),
      execute: async () => {
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        return agentBrowserRun(sid, ctx.getCwd(), "close --all", 10);
      },
    }),
  } as const;
}
