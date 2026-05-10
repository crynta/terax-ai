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

export function buildNucleiTools(ctx: ToolContext) {
  return {
    vuln_scan: tool({
      description:
        "Run nuclei vulnerability scanner against a target URL or IP. Uses community templates covering CVEs, misconfigs, exposed admin panels, default credentials, XSS, SQLi, SSRF, LFI, and more. Always run after crawling to maximize coverage. ONLY use on authorized in-scope targets.",
      inputSchema: z.object({
        target: z.string().describe("Target URL or IP"),
        templates: z.array(z.string()).optional().describe("Template tags or directory names e.g. ['cve','misconfig','default-logins','xss','sqli']"),
        severity: z.array(z.enum(["critical","high","medium","low","info"])).optional().describe("Severity filter"),
        proxy: z.string().optional().describe("Route through mitmproxy: http://127.0.0.1:8080"),
        rate_limit: z.number().int().min(1).max(5000).optional().describe("Requests per second, default 150"),
        output_file: z.string().optional().describe("Save results to file"),
        exclude_templates: z.array(z.string()).optional(),
        custom_headers: z.record(z.string(), z.string()).optional().describe("Headers for authenticated scanning e.g. {Authorization: 'Bearer ...'}"),
        background: z.boolean().optional().describe("Run as background process for large scans"),
      }),
      execute: async ({
        target, templates, severity, proxy, rate_limit,
        output_file, exclude_templates, custom_headers, background,
      }) => {
        const templateTags = templates?.length ? templates.map((t) => `-t ${t}`).join(" ") : "";
        const severityFlags = severity?.length ? `-severity ${severity.join(",")}` : "";
        const exclFlags = exclude_templates?.length ? exclude_templates.map((t) => `-exclude ${t}`).join(" ") : "";
        const headerFlags = custom_headers ? Object.entries(custom_headers).map(([k, v]) => `-H "${k}: ${v}"`).join(" ") : "";
        const outFlag = output_file ? `-o ${output_file}` : "";
        const cmd = [
          "nuclei",
          `-u ${target}`,
          templateTags,
          severityFlags,
          proxy ? `-proxy ${proxy}` : "",
          `-rl ${rate_limit ?? 150}`,
          outFlag,
          exclFlags,
          headerFlags,
          "-json",
        ].filter(Boolean).join(" ");

        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };

        if (background) {
          try {
            const handle = await native.shellBgSpawn(cmd, ctx.getCwd());
            return { handle, target, background: true, ok: true };
          } catch (e) {
            return { error: String(e) };
          }
        }

        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        const shellId = await getSessionShell(sid, ctx.getCwd());
        try {
          const r = await native.shellSessionRun(shellId, cmd, null, 300);
          const findings = r.stdout.trim().split("\n").filter(Boolean).map((l) => {
            try { return JSON.parse(l); } catch { return { raw: l }; }
          });
          return {
            findings,
            count: findings.length,
            output_file: output_file ?? null,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    vuln_scan_list: tool({
      description:
        "Run nuclei against a list of URLs from a file (e.g. the output of web_crawl). Scans every discovered endpoint for vulnerabilities. Faster than scanning URLs one-by-one. ONLY use on authorized in-scope targets.",
      inputSchema: z.object({
        urls_file: z.string().describe("Path to file containing URLs, one per line (e.g. /tmp/mr-robot/endpoints.txt)"),
        templates: z.array(z.string()).optional().describe("Template tags or IDs"),
        severity: z.array(z.enum(["critical","high","medium","low","info"])).optional(),
        proxy: z.string().optional(),
        rate_limit: z.number().int().optional().describe("Default 150"),
        output_file: z.string().optional(),
        background: z.boolean().optional().describe("Run as background process"),
      }),
      execute: async ({
        urls_file, templates, severity, proxy, rate_limit, output_file, background,
      }) => {
        const templateTags = templates?.length ? templates.map((t) => `-t ${t}`).join(" ") : "";
        const severityFlags = severity?.length ? `-severity ${severity.join(",")}` : "";
        const outFlag = output_file ? `-o ${output_file}` : "";
        const cmd = [
          "nuclei",
          `-list ${urls_file}`,
          templateTags,
          severityFlags,
          proxy ? `-proxy ${proxy}` : "",
          `-rl ${rate_limit ?? 150}`,
          outFlag,
          "-json",
        ].filter(Boolean).join(" ");

        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };

        if (background) {
          try {
            const handle = await native.shellBgSpawn(cmd, ctx.getCwd());
            return { handle, urls_file, background: true, ok: true };
          } catch (e) {
            return { error: String(e) };
          }
        }

        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        const shellId = await getSessionShell(sid, ctx.getCwd());
        try {
          const r = await native.shellSessionRun(shellId, cmd, null, 300);
          const findings = r.stdout.trim().split("\n").filter(Boolean).map((l) => {
            try { return JSON.parse(l); } catch { return { raw: l }; }
          });
          return {
            findings,
            count: findings.length,
            output_file: output_file ?? null,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    nuclei_templates: tool({
      description:
        "List available nuclei templates filtered by keyword or tag. Use to discover what templates exist for a specific technology (e.g. WordPress, Apache, Jenkins) before scanning.",
      inputSchema: z.object({
        filter: z.string().optional().describe("Keyword to filter templates by e.g. 'wordpress', 'apache', 'jenkins', 'cve-2024'"),
      }),
      execute: async ({ filter }) => {
        const filterFlag = filter ? ` | grep -i ${filter}` : "";
        const cmd = `nuclei -tl -json${filterFlag} 2>/dev/null | head -200`;
        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };
        const cwd = ctx.getCwd();
        try {
          const shellId = await (async () => {
            const p = native.shellSessionOpen(cwd);
            return p;
          })();
          const r = await native.shellSessionRun(shellId, cmd, null, 30);
          const templates = r.stdout.trim().split("\n").filter(Boolean).map((l) => {
            try { return JSON.parse(l); } catch { return { name: l }; }
          });
          return { templates, count: templates.length };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
