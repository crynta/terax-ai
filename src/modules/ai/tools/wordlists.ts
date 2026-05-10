import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { checkShellCommand } from "../lib/security";
import type { ToolContext } from "./context";

const WORDLIST_PATHS: Record<string, string[]> = {
  rockyou: ["/usr/share/wordlists/rockyou.txt"],
  common: ["/usr/share/seclists/Discovery/Web-Content/common.txt"],
  directories: ["/usr/share/seclists/Discovery/Web-Content/directory-list-2.3-medium.txt"],
  subdomains: ["/usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt"],
  passwords: ["/usr/share/seclists/Passwords/Common-Credentials/10k-most-common.txt"],
  usernames: ["/usr/share/seclists/Usernames/top-usernames-shortlist.txt"],
  big: ["/usr/share/seclists/Discovery/Web-Content/big.txt"],
  "api-endpoints": ["/usr/share/seclists/Discovery/Web-Content/api/objects.txt"],
  sqli: ["/usr/share/seclists/Fuzzing/SQLi/Generic-SQLi.txt"],
  xss: ["/usr/share/seclists/Fuzzing/XSS/XSS-Jhaddix.txt"],
};

const sessionShells = new Map<string, Promise<number>>();

async function getSessionShell(sessionId: string, cwd: string | null): Promise<number> {
  let p = sessionShells.get(sessionId);
  if (!p) {
    p = native.shellSessionOpen(cwd);
    sessionShells.set(sessionId, p);
  }
  return p;
}

export function buildWordlistTools(ctx: ToolContext) {
  return {
    wordlist_get: tool({
      description:
        "Get the absolute path to a wordlist by name. Use this before any brute-force tool (hydra, ffuf, john, hashcat) to get the correct path. Common names: 'rockyou', 'common', 'directories', 'subdomains', 'passwords', 'usernames', 'big', 'api-endpoints'.",
      inputSchema: z.object({
        name: z.enum([
          "rockyou", "common", "directories", "subdomains", "passwords",
          "usernames", "big", "api-endpoints", "sqli", "xss",
        ]),
      }),
      execute: async ({ name }) => {
        const candidates = WORDLIST_PATHS[name];
        if (!candidates) return { name, path: null, exists: false, error: "unknown wordlist" };
        const sid = ctx.getSessionId();
        if (!sid) return { name, path: null, exists: false, error: "no active chat session" };
        const shellId = await getSessionShell(sid, ctx.getCwd());
        for (const p of candidates) {
          const cmd = `test -f '${p}' && echo 'EXISTS'`;
          const safety = checkShellCommand(cmd);
          if (!safety.ok) continue;
          try {
            const r = await native.shellSessionRun(shellId, cmd, 5);
            if (r.stdout.trim() === "EXISTS") {
              return { name, path: p, exists: true };
            }
          } catch {
            continue;
          }
        }
        return { name, path: null, exists: false, hint: "Some wordlists may be gzipped. Try: gunzip /usr/share/wordlists/rockyou.txt.gz" };
      },
    }),

    hash_identify: tool({
      description:
        "Identify the type of a hash before cracking. Returns likely hash types ranked by probability (MD5, SHA1, NTLM, bcrypt, etc.) and the recommended john/hashcat format string to use.",
      inputSchema: z.object({
        hash: z.string().describe("The raw hash string to identify."),
      }),
      execute: async ({ hash }) => {
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        const shellId = await getSessionShell(sid, ctx.getCwd());
        const cmd = `echo '${hash.replace(/'/g, "'\\''")}' | hashid -m -j 2>/dev/null`;
        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };
        try {
          const r = await native.shellSessionRun(shellId, cmd, 15);
          if (r.exit_code !== 0) return { error: "hashid failed: " + (r.stderr || r.stdout) };
          const parsed = JSON.parse(r.stdout);
          return { hash: hash.slice(0, 40), types: parsed };
        } catch (e) {
          return { error: String(e), hash: hash.slice(0, 40) };
        }
      },
    }),

    crack_hash: tool({
      description:
        "Crack a hash using john or hashcat. Always call hash_identify first to get the correct format. Runs in background — use bash_logs to follow progress. Saves cracked result to /tmp/mr-robot/cracked.txt.",
      inputSchema: z.object({
        hash: z.string(),
        format: z.string().describe("John format string from hash_identify e.g. 'md5crypt', 'ntlm', 'bcrypt'"),
        wordlist: z.string().optional().describe("Absolute wordlist path. Defaults to rockyou."),
        tool: z.enum(["john", "hashcat"]).optional().describe("Default: john"),
        hashcat_mode: z.number().int().optional().describe("Hashcat -m mode from hash_identify"),
      }),
      execute: async ({ hash, format, wordlist, tool: crackTool, hashcat_mode }) => {
        const cwd = ctx.getCwd();
        const hashFile = "/tmp/mr-robot/hash.txt";
        const outFile = "/tmp/mr-robot/cracked.txt";
        const potFile = "/tmp/mr-robot/john.pot";
        try {
          await native.writeFile(hashFile, hash + "\n");
        } catch (e) {
          return { error: "failed to write hash file: " + String(e) };
        }
        let cmd: string;
        if (crackTool === "hashcat" && hashcat_mode !== undefined) {
          const wl = wordlist || "/usr/share/wordlists/rockyou.txt";
          cmd = `hashcat -m ${hashcat_mode} '${hashFile}' '${wl}' --outfile '${outFile}' --force 2>/dev/null`;
        } else {
          const wl = wordlist || "/usr/share/wordlists/rockyou.txt";
          cmd = `john --format='${format}' --wordlist='${wl}' '${hashFile}' --pot='${potFile}' 2>/dev/null; john --show --format='${format}' '${hashFile}' 2>/dev/null > '${outFile}'`;
        }
        const safety = checkShellCommand(cmd);
        if (!safety.ok) return { error: safety.reason };
        try {
          const handle = await native.shellBgSpawn(cmd, cwd);
          return { handle, format, hash_file: hashFile, output_file: outFile, ok: true };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
