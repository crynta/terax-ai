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

export function buildKatanaTools(ctx: ToolContext) {
  return {
    web_crawl: tool({
      description:
        "Crawl a web application to discover all endpoints, forms, parameters, and links. Respects scope. Use before fuzzing and vulnerability scanning to map the full attack surface. Katana is fast and JavaScript-aware. Output is saved to /tmp/mr-robot/endpoints.txt for subsequent scanning with vuln_scan_list.",
      inputSchema: z.object({
        url: z.string().describe("Target URL (in-scope authorized target only)"),
        depth: z.number().int().min(1).max(10).optional().describe("Crawl depth, default 3"),
        js_crawl: z.boolean().optional().describe("Enable JS parsing for SPAs, default true"),
        proxy: z.string().optional().describe("Route through mitmproxy: http://127.0.0.1:8080"),
        scope: z.string().optional().describe("Regex scope filter e.g. '.*\\.example\\.com'"),
        headless: z.boolean().optional().describe("Use headless Chrome for JS-heavy apps"),
        form_extraction: z.boolean().optional().describe("Extract form fields and parameters"),
        concurrency: z.number().int().min(1).max(50).optional(),
        timeout: z.number().int().optional().describe("Timeout in seconds, default 60"),
        background: z.boolean().optional().describe("Run as background process for deep crawls"),
      }),
      execute: async ({
        url, depth, js_crawl, proxy, scope, headless,
        form_extraction, concurrency, timeout, background,
      }) => {
        const flags = [
          `-d ${depth ?? 3}`,
          js_crawl !== false ? "-jc" : "",
          proxy ? `-p ${proxy}` : "",
          scope ? `-fs ${scope}` : "",
          headless ? "-headless" : "",
          form_extraction ? "-ef" : "",
          concurrency ? `-c ${concurrency}` : "",
          `-t ${timeout ?? 60}`,
        ].filter(Boolean).join(" ");

        const outputFile = "/tmp/mr-robot/endpoints.txt";
        const cmd = `katana -u ${url} ${flags} -o ${outputFile} -json`.replace(/\s+/g, " ").trim();
        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };

        if (background) {
          try {
            const handle = await native.shellBgSpawn(cmd, ctx.getCwd());
            return { handle, output_file: outputFile, background: true, ok: true };
          } catch (e) {
            return { error: String(e) };
          }
        }

        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        const shellId = await getSessionShell(sid, ctx.getCwd());
        try {
          const r = await native.shellSessionRun(shellId, cmd, null, timeout ?? 120);
          const endpoints = r.stdout.trim().split("\n").filter(Boolean).map((l) => {
            try { return JSON.parse(l); } catch { return { url: l }; }
          });
          return {
            endpoints,
            count: endpoints.length,
            stdout: r.stdout,
            stderr: r.stderr,
            exit_code: r.exit_code,
            output_file: outputFile,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
