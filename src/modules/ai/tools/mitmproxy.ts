import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { checkShellCommand } from "../lib/security";
import type { ToolContext } from "./context";

export function buildMitmproxyTools(ctx: ToolContext) {
  return {
    proxy_start: tool({
      description:
        "Start mitmproxy as a background intercepting proxy on the given port (default 8080). All traffic routed through it is captured. Use --mode transparent for non-browser tools. Returns a handle for proxy_logs and proxy_stop.",
      inputSchema: z.object({
        port: z.number().int().default(8080),
        mode: z.enum(["regular", "transparent", "socks5"]).optional(),
        save_file: z.string().optional().describe("Save captured flows to .mitm file for later analysis"),
        scripts: z.string().optional().describe("Path to mitmproxy addon script for automated manipulation"),
      }),
      execute: async ({ port, mode, save_file, scripts }) => {
        const modeFlag = mode === "regular" || !mode ? "" : `--mode ${mode}`;
        const saveFlag = save_file ? `-w ${save_file}` : "";
        const scriptFlag = scripts ? `--scripts ${scripts}` : "";
        const cmd = `mitmdump -p ${port} ${modeFlag} ${saveFlag} ${scriptFlag}`.replace(/\s+/g, " ").trim();
        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };
        const cwd = ctx.getCwd();
        try {
          const handle = await native.shellBgSpawn(cmd, cwd);
          return { handle, port, ok: true };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    proxy_flows: tool({
      description:
        "Read captured flows from a running mitmproxy save file. Returns [{ method, url, status, request_headers, response_headers, request_body, response_body }]. Use to inspect captured traffic for secrets, tokens, API endpoints, and injection points.",
      inputSchema: z.object({
        file: z.string().describe("Path to the .mitm save file from proxy_start"),
        max_flows: z.number().int().min(1).max(500).optional().describe("Max flows to return, default 50"),
      }),
      execute: async ({ file, max_flows }) => {
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        const limit = max_flows ?? 50;
        const cmd = `mitmproxy --no-server -r ${file} -s /dev/stdin -q <<< 'import sys, json; flows = list(sys.stdin); print(json.dumps([{k: str(v) for k,v in f.request.__dict__.items()} for f in flows[:${limit}]]))' 2>/dev/null || echo '{"error":"flow parsing failed"}'`;
        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };
        const shellId = await (async () => {
          const p = native.shellSessionOpen(ctx.getCwd());
          return p;
        })();
        try {
          const r = await native.shellSessionRun(shellId, cmd, null, 30);
          if (r.exit_code !== 0) return { error: r.stderr || r.stdout };
          try {
            return JSON.parse(r.stdout);
          } catch {
            return { raw: r.stdout };
          }
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    proxy_intercept: tool({
      description:
        "Start mitmproxy with a Python addon script that modifies requests or responses in flight. Provide the script content as a string — it gets written to /tmp/mr-robot/proxy_addon.py and loaded. Use for: injecting auth headers, modifying form fields, replacing responses for client-side testing.",
      inputSchema: z.object({
        script_content: z.string().describe("Full Python mitmproxy addon script content"),
        port: z.number().int().default(8080),
        save_file: z.string().optional(),
      }),
      execute: async ({ script_content, port, save_file }) => {
        const scriptPath = "/tmp/mr-robot/proxy_addon.py";
        try {
          await native.writeFile(scriptPath, script_content);
        } catch (e) {
          return { error: `failed to write addon script: ${String(e)}` };
        }
        const saveFlag = save_file ? `-w ${save_file}` : "";
        const cmd = `mitmdump -p ${port} --scripts ${scriptPath} ${saveFlag}`.trim();
        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };
        const cwd = ctx.getCwd();
        try {
          const handle = await native.shellBgSpawn(cmd, cwd);
          return { handle, port, script: scriptPath, ok: true };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    proxy_stop: tool({
      description:
        "Stop a running mitmproxy/mitmdump process by handle from proxy_start. Flushes the save file before exiting.",
      inputSchema: z.object({
        handle: z.number().int(),
      }),
      execute: async ({ handle }) => {
        try {
          await native.shellBgKill(handle);
          return { handle, ok: true };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
