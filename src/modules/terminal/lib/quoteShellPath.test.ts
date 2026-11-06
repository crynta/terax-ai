import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ IS_WINDOWS: false }));

import { quoteShellArg, unescapeForShell } from "@/lib/shellQuote";
import { formatDroppedPaths, quoteShellPath } from "./quoteShellPath";

describe("quoteShellPath", () => {
  it("passes a clean path through unquoted so apps can resolve it", () => {
    expect(quoteShellPath("/Users/me/img.png")).toBe("/Users/me/img.png");
  });

  it("quotes a path containing spaces", () => {
    expect(quoteShellPath("/Users/me/My Photos/a.png")).toBe(
      "'/Users/me/My Photos/a.png'",
    );
  });

  it("escapes single quotes inside the path", () => {
    expect(quoteShellPath("/tmp/it's a file")).toBe(`'/tmp/it'\\''s a file'`);
  });

  it("leaves a clean Windows drive path unquoted", () => {
    expect(quoteShellPath("C:\\Users\\me\\img.png", true)).toBe(
      "C:\\Users\\me\\img.png",
    );
  });

  it("quotes a path with shell metacharacters", () => {
    expect(quoteShellPath("/tmp/$(whoami).png")).toBe("'/tmp/$(whoami).png'");
  });

  it("joins multiple paths with a trailing space", () => {
    expect(formatDroppedPaths(["/a/b.png", "/c/d.png"])).toBe(
      "/a/b.png /c/d.png ",
    );
  });
});

describe("literal drop arguments", () => {
  it.each([
    "$(Get-Date).txt",
    "$variable.txt",
    "tick`name.txt",
    "with space.txt",
    "it's.txt",
    "it‘s.txt",
    "it’s.txt",
  ])("keeps PowerShell %s literal", (name) => {
    const path = `C:\\Downloads\\${name}`;
    expect(quoteShellPath(path, true)).toBe(quoteShellArg(path, true));
    expect(unescapeForShell(quoteShellPath(path, true), true)).toBe(path);
  });

  it("quotes literal POSIX backslashes, including a Windows-hosted WSL path", () => {
    const path = "/mnt/c/Downloads/literal\\name.txt";
    expect(unescapeForShell(quoteShellPath(path, false), false)).toBe(path);
    expect(formatDroppedPaths([path], false)).toBe("'/mnt/c/Downloads/literal'\\\\'name.txt' ");
  });
});

it("round trips literal paths through the platform shell", () => {
  const windows = process.platform === "win32";
  const paths = [
    "/tmp/$(echo expanded).txt",
    "/tmp/$variable",
    "/tmp/tick`name",
    "/tmp/it’s.txt",
    "/tmp/it's file.txt",
    "/tmp/literal\\name",
    "/tmp/a\\'b.txt",
  ];
  const quoted = paths.map((path) => quoteShellPath(path, windows));
  const output = windows
    ? execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); function Capture([string]$value) { [Console]::Write($value); [Console]::Write([char]0) }; ${quoted.map((path) => `Capture ${path}`).join("; ")}`,
        ],
        { encoding: "utf8" },
      )
    : execFileSync("/bin/sh", ["-c", `printf '%s\\0' ${quoted.join(" ")}`], {
        encoding: "utf8",
      });
  expect(output).toBe(`${paths.join("\0")}\0`);
});

const fishProgram = process.platform === "win32" ? "" : spawnSync("/bin/sh", ["-c", "command -v fish"], { encoding: "utf8" }).stdout.trim();
it.runIf(Boolean(fishProgram))("round trips backslashes and apostrophes through fish", () => {
  for (const path of ["/tmp/a\\'b.txt", "/tmp/a\\\\b.txt", "/tmp/a\\", "/tmp/$(echo expanded)"]) {
    const output = execFileSync(fishProgram, ["--no-config", "-c", `printf '%s' ${quoteShellPath(path, false)}`], { encoding: "utf8" });
    expect(output).toBe(path);
  }
});
