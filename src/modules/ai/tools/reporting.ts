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

const htmlEscape = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function buildReportHtml(params: {
  title: string;
  target: string;
  date: string;
  nmapOutput: string;
  nucleiOutput: string;
  flags: string[];
  creds: Array<{ user: string; password?: string; hash?: string; service: string }>;
  findings: string;
  screenshots: string[];
}): string {
  const screenshotImgs = params.screenshots.map((s) =>
    `<img src="${htmlEscape(s)}" alt="screenshot" style="max-width:100%;border:1px solid #333;border-radius:4px;margin:8px 0;" />`
  ).join("\n");
  const flagItems = params.flags.map((f) => `<li><code>${htmlEscape(f)}</code></li>`).join("\n");
  const credRows = params.creds.map((c) =>
    `<tr><td>${htmlEscape(c.service)}</td><td>${htmlEscape(c.user)}</td><td>${htmlEscape(c.password ?? "-")}</td><td>${htmlEscape(c.hash ?? "-")}</td></tr>`
  ).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${params.title} — Pentest Report</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;padding:40px;line-height:1.6}
.container{max-width:900px;margin:0 auto}
h1{font-size:28px;color:#f0f6fc;border-bottom:2px solid #30363d;padding-bottom:12px;margin-bottom:24px}
h2{font-size:20px;color:#58a6ff;margin:28px 0 12px;padding-bottom:6px;border-bottom:1px solid #21262d}
h3{font-size:16px;color:#c9d1d9;margin:16px 0 8px}
.meta{color:#8b949e;font-size:14px;margin-bottom:20px}
pre{background:#161b22;padding:12px;border-radius:6px;overflow-x:auto;font-family:'JetBrains Mono','Cascadia Code',monospace;font-size:13px;border:1px solid #21262d;margin:8px 0}
code{background:#161b22;padding:2px 6px;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:13px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:8px 12px;text-align:left;border:1px solid #30363d}
th{background:#161b22;color:#58a6ff;font-weight:600}
tr:nth-child(even){background:#0d1117}
tr:nth-child(odd){background:#161b22}
.critical{color:#f85149;font-weight:700}
.high{color:#d29922;font-weight:600}
.medium{color:#58a6ff}
.low{color:#8b949e}
.finding{margin:12px 0;padding:12px;border-radius:6px;border:1px solid #21262d;background:#161b22}
.finding .sev{display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:700;text-transform:uppercase}
.sev-critical{background:#f8514933;color:#f85149;border:1px solid #f8514966}
.sev-high{background:#d2992233;color:#d29922;border:1px solid #d2992266}
.sev-medium{background:#58a6ff33;color:#58a6ff;border:1px solid #58a6ff66}
.sev-low{background:#8b949e33;color:#8b949e;border:1px solid #8b949e66}
.screenshots{display:flex;flex-direction:column;gap:12px}
.footer{text-align:center;color:#484f58;font-size:12px;margin-top:40px;padding-top:12px;border-top:1px solid #21262d}
</style>
</head>
<body>
<div class="container">
<h1>${htmlEscape(params.title)}</h1>
<div class="meta">
<strong>Target:</strong> ${htmlEscape(params.target)}<br>
<strong>Date:</strong> ${htmlEscape(params.date)}<br>
<strong>Tester:</strong> Mr. Robot / Terax AI
</div>

<h2>Executive Summary</h2>
<p>This report documents the security assessment of <strong>${htmlEscape(params.target)}</strong> conducted by Mr. Robot (Terax AI autonomous security agent). The assessment identified potential vulnerabilities and security weaknesses that should be addressed to improve the security posture of the target.</p>

<h2>Attack Path Timeline</h2>
<pre>1. Reconnaissance — nmap scan, service enumeration
2. Vulnerability Identification — nuclei scan, hacktricks lookup
3. Exploitation — targeted payload delivery
4. Privilege Escalation — post-exploitation enumeration
5. Flag/Loot Capture — sensitive data extraction
6. Reporting — findings documentation</pre>

<h2>Findings</h2>
${params.findings || '<p>No structured findings recorded. See raw output sections.</p>'}

${params.flags.length > 0 ? `
<h2>Flags Captured</h2>
<ul>${flagItems}</ul>` : ""}

${params.creds.length > 0 ? `
<h2>Credentials Obtained</h2>
<table><thead><tr><th>Service</th><th>User</th><th>Password</th><th>Hash</th></tr></thead>
<tbody>${credRows}</tbody></table>` : ""}

${screenshotImgs ? `
<h2>Screenshots</h2>
<div class="screenshots">${screenshotImgs}</div>` : ""}

<h2>Raw Tool Output</h2>
<h3>Nmap</h3>
<pre>${htmlEscape(params.nmapOutput || "No nmap output available.")}</pre>

<h3>Nuclei / Vulnerability Scan</h3>
<pre>${params.nucleiOutput || "No nuclei findings."}</pre>

<div class="footer">
Generated by Mr. Robot (Terax AI) — ${params.date}
</div>
</div>
</body>
</html>`;
}

export function buildReportingTools(ctx: ToolContext) {
  return {
    generate_report: tool({
      description:
        "Generate a full engagement report as HTML and PDF. ONLY call this when the user explicitly asks for a report — never call it automatically. Reads all loot from /tmp/mr-robot/ and produces a structured pentest report with executive summary, findings, attack path, evidence, and remediation.",
      inputSchema: z.object({
        title: z.string().optional().describe("Report title e.g. 'TryHackMe - Skynet Box'"),
        output_format: z.array(z.enum(["html", "pdf", "markdown"])).optional().describe("Default: all three"),
        include_screenshots: z.boolean().optional().describe("Embed screenshots from /tmp/mr-robot/*.png"),
      }),
      execute: async ({ title, output_format, include_screenshots }) => {
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        const shellId = await getSessionShell(sid, ctx.getCwd());
        const formats = output_format ?? ["html", "pdf", "markdown"];

        let sessionData: Record<string, unknown> = {};
        try {
          const r = await native.readFile("/tmp/mr-robot/session.json");
          if (r.kind === "text") sessionData = JSON.parse(r.content);
        } catch { /* no session file */ }

        let nmapOutput = "";
        try {
          const r = await native.readFile("/tmp/mr-robot/nmap.txt");
          if (r.kind === "text") nmapOutput = r.content.slice(0, 10000);
        } catch { /* no nmap file */ }

        let flags: string[] = [];
        try {
          const r = await native.readFile("/tmp/mr-robot/flags.md");
          if (r.kind === "text") flags = r.content.split("\n").filter(Boolean);
          if (Array.isArray(sessionData.flags)) flags = [...new Set([...flags, ...(sessionData.flags as string[])])];
        } catch { /* no flags file */ }

        let findings = "";
        try {
          const r = await native.readFile("/tmp/mr-robot/findings.md");
          if (r.kind === "text") findings = r.content;
        } catch { /* no findings file */ }

        let nucleiOutput = "";
        try {
          const r = await native.readFile("/tmp/mr-robot/nuclei.txt");
          if (r.kind === "text") nucleiOutput = r.content.slice(0, 10000);
        } catch { /* no nuclei file */ }

        let creds: Array<{ user: string; password?: string; hash?: string; service: string }> = [];
        if (Array.isArray(sessionData.creds)) creds = sessionData.creds as typeof creds;

        let screenshots: string[] = [];
        if (include_screenshots) {
          try {
            const r = await native.shellSessionRun(shellId, "ls /tmp/mr-robot/*.png 2>/dev/null || true", 5);
            screenshots = r.stdout.trim().split("\n").filter(Boolean);
          } catch { /* no screenshots */ }
        }

        const target = (sessionData.target as string) || "unknown";
        const reportTitle = title || `Pentest Report — ${target}`;
        const date = new Date().toISOString().split("T")[0];
        const reportDir = "/tmp/mr-robot";
        const files: string[] = [];

        const html = buildReportHtml({
          title: reportTitle, target, date,
          nmapOutput, nucleiOutput, flags, creds, findings, screenshots,
        });

        try {
          await native.writeFile(`${reportDir}/report.html`, html);
          files.push(`${reportDir}/report.html`);

          if (formats.includes("markdown")) {
            const md = [
              `# ${reportTitle}`,
              `**Target:** ${target}  `,
              `**Date:** ${date}  `,
              `**Tester:** Mr. Robot / Terax AI`,
              "",
              "## Executive Summary",
              `Assessment of ${target}.`,
              "",
              "## Findings",
              findings || "No structured findings.",
              "",
              flags.length > 0 ? "## Flags Captured\n" + flags.map((f) => `- \`${f}\``).join("\n") : "",
              "",
              "## Raw Output",
              "```\n" + nmapOutput.slice(0, 5000) + "\n```",
            ].filter(Boolean).join("\n");
            await native.writeFile(`${reportDir}/report.md`, md);
            files.push(`${reportDir}/report.md`);
          }

          const warnings: string[] = [];
          if (formats.includes("pdf")) {
            const pdfCmd = `wkhtmltopdf --enable-local-file-access '${reportDir}/report.html' '${reportDir}/report.pdf' 2>/dev/null`;
            const pdfSafety = checkShellCommand(pdfCmd);
            if (pdfSafety.ok) {
              try {
                await native.shellSessionRun(shellId, pdfCmd, 30);
                files.push(`${reportDir}/report.pdf`);
              } catch {
                warnings.push("wkhtmltopdf not available, PDF skipped");
              }
            } else {
              warnings.push("wkhtmltopdf not available, PDF skipped");
            }
          }

          return { ok: true, files, report_title: reportTitle, warnings: warnings.length > 0 ? warnings : undefined };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
