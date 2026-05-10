import { describe, expect, it } from "vitest";
import {
  checkReadable,
  checkWritable,
  checkShellCommand,
} from "@/modules/ai/lib/security";

describe("checkReadable", () => {
  it("allows normal files", () => {
    expect(checkReadable("/home/user/src/main.ts")).toEqual({ ok: true });
    expect(checkReadable("C:\\Users\\dev\\package.json")).toEqual({
      ok: true,
    });
  });

  it("blocks .env files", () => {
    expect(checkReadable(".env").ok).toBe(false);
    expect(checkReadable(".env.local").ok).toBe(false);
    expect(checkReadable(".env.production").ok).toBe(false);
  });

  it("blocks private keys", () => {
    expect(checkReadable("/home/user/.ssh/id_rsa").ok).toBe(false);
    expect(checkReadable("/home/user/cert.pem").ok).toBe(false);
    expect(checkReadable("/home/user/server.key").ok).toBe(false);
  });

  it("blocks secret config files", () => {
    expect(checkReadable("/home/user/.npmrc").ok).toBe(false);
    expect(checkReadable("/home/user/.netrc").ok).toBe(false);
    expect(checkReadable("secrets.json").ok).toBe(false);
    expect(checkReadable("secret.yaml").ok).toBe(false);
  });

  it("blocks paths inside protected directories", () => {
    expect(checkReadable("/home/user/.ssh/config").ok).toBe(false);
    expect(checkReadable("/home/user/.aws/credentials").ok).toBe(false);
    expect(checkReadable("/home/user/.kube/config").ok).toBe(false);
    expect(checkReadable("/project/.git/HEAD").ok).toBe(false);
  });
});

describe("checkWritable", () => {
  it("inherits read restrictions", () => {
    expect(checkWritable(".env").ok).toBe(false);
    expect(checkWritable("/home/user/.ssh/id_rsa").ok).toBe(false);
  });

  it("blocks writes to system directories", () => {
    expect(checkWritable("/etc/passwd").ok).toBe(false);
    expect(checkWritable("/var/db/test").ok).toBe(false);
  });

  it("allows writes to normal paths", () => {
    expect(checkWritable("/home/user/src/main.ts")).toEqual({ ok: true });
  });
});

describe("checkShellCommand", () => {
  it("allows normal commands", () => {
    expect(checkShellCommand("ls -la")).toEqual({ ok: true });
    expect(checkShellCommand("npm install")).toEqual({ ok: true });
    expect(checkShellCommand("git commit -m 'fix'")).toEqual({ ok: true });
  });

  it("blocks rm -rf /", () => {
    expect(checkShellCommand("rm -rf /").ok).toBe(false);
    expect(checkShellCommand("rm -rf '/'").ok).toBe(false);
    expect(checkShellCommand("rm --recursive --force /").ok).toBe(false);
  });

  it("blocks --no-preserve-root", () => {
    expect(checkShellCommand("rm -rf --no-preserve-root /").ok).toBe(false);
  });

  it("blocks dd to block devices", () => {
    expect(checkShellCommand("dd if=/dev/zero of=/dev/sda").ok).toBe(false);
    expect(checkShellCommand("dd if=file of=/dev/disk0").ok).toBe(false);
  });

  it("blocks disk formatting commands", () => {
    expect(checkShellCommand("mkfs.ext4 /dev/sda1").ok).toBe(false);
    expect(checkShellCommand("fdisk /dev/sda").ok).toBe(false);
    expect(checkShellCommand("diskutil eraseDisk JHFS+ New /dev/disk0").ok).toBe(
      false,
    );
  });
});
