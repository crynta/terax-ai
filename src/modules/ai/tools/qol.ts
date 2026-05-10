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

export function buildQolTools(ctx: ToolContext) {
  return {
    vpn_check: tool({
      description:
        "Check VPN status and get tun0 IP. Always run at the start of a THM/HTB engagement to confirm the VPN tunnel is up and get your attack IP for reverse shells.",
      inputSchema: z.object({}),
      execute: async () => {
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        const shellId = await getSessionShell(sid, ctx.getCwd());
        const cmd = "ip addr show tun0 2>/dev/null || ip addr show tap0 2>/dev/null || echo 'NO_VPN'";
        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };
        try {
          const r = await native.shellSessionRun(shellId, cmd, 10);
          if (r.stdout.trim() === "NO_VPN") {
            return { connected: false, interface: null, ip: null };
          }
          const ipMatch = r.stdout.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
          const iface = r.stdout.includes("tun0") ? "tun0" : r.stdout.includes("tap0") ? "tap0" : "unknown";
          return {
            connected: !!ipMatch,
            interface: iface,
            ip: ipMatch ? ipMatch[1] : null,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    scope_check: tool({
      description:
        "Validate that a target IP or domain is in scope before running any offensive tool. Checks against the scope list set at engagement start. Refuses out-of-scope targets.",
      inputSchema: z.object({
        target: z.string(),
      }),
      execute: async ({ target }) => {
        try {
          const r = await native.readFile("/tmp/mr-robot/scope.txt");
          if (r.kind !== "text") return { target, in_scope: false, error: "no scope file set. Run scope_set first." };
          const lines = r.content.split("\n").filter(Boolean).map((l) => l.trim());
          const inScope = lines.some((l) => {
            if (l.includes("/")) {
              const [base, bits] = l.split("/");
              const mask = parseInt(bits, 10);
              if (isNaN(mask)) return false;
              const targetNum = target.split(".").map(Number);
              const baseNum = base.split(".").map(Number);
              if (targetNum.length !== 4 || baseNum.length !== 4) return false;
              if (targetNum.some(isNaN) || baseNum.some(isNaN)) return false;
              const maskBits = ~((1 << (32 - mask)) - 1) >>> 0;
              const targetInt = ((targetNum[0] << 24) | (targetNum[1] << 16) | (targetNum[2] << 8) | targetNum[3]) >>> 0;
              const baseInt = ((baseNum[0] << 24) | (baseNum[1] << 16) | (baseNum[2] << 8) | baseNum[3]) >>> 0;
              return (targetInt & maskBits) === (baseInt & maskBits);
            }
            return target === l || (l.includes(".") && target.endsWith("." + l));
          });
          return { target, in_scope: inScope, scope_list: lines };
        } catch {
          return { target, in_scope: false, error: "no scope file set. Run scope_set first." };
        }
      },
    }),

    scope_set: tool({
      description:
        "Set the engagement scope at session start. All offensive tools will refuse to run against out-of-scope targets. Pass IPs, CIDR ranges, or domain names.",
      inputSchema: z.object({
        targets: z.array(z.string()).describe("IPs, CIDRs, or domains in scope e.g. ['10.10.10.5', '10.10.11.0/24', 'example.com']"),
      }),
      execute: async ({ targets }) => {
        try {
          await native.writeFile("/tmp/mr-robot/scope.txt", targets.join("\n") + "\n");
          return { ok: true, scope: targets, count: targets.length };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    session_save: tool({
      description:
        "Save current engagement state (target, scope, found creds, flags, notes) to /tmp/mr-robot/session.json so it can be resumed in a future Terax session.",
      inputSchema: z.object({
        target: z.string(),
        notes: z.string().optional(),
        creds: z.array(z.object({ user: z.string(), password: z.string().optional(), hash: z.string().optional(), service: z.string() })).optional(),
        flags: z.array(z.string()).optional(),
      }),
      execute: async ({ target, notes, creds, flags }) => {
        const session = { target, notes, creds, flags, savedAt: new Date().toISOString() };
        try {
          await native.writeFile("/tmp/mr-robot/session.json", JSON.stringify(session, null, 2) + "\n");
          return { ok: true, target, saved_at: session.savedAt };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    session_load: tool({
      description:
        "Load a previously saved engagement session. Restores target, scope, credentials, flags, and notes so Mr. Robot can continue where it left off.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const r = await native.readFile("/tmp/mr-robot/session.json");
          if (r.kind !== "text") return { error: "no saved session found" };
          const session = JSON.parse(r.content);
          return { ok: true, session };
        } catch {
          return { error: "no saved session found at /tmp/mr-robot/session.json" };
        }
      },
    }),
  } as const;
}
