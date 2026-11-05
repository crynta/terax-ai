import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { escapeForShell, unescapeForShell } from "@/lib/shellQuote";

const names = [
  "My Folder/notes file.txt",
  "it's here",
  'a "quote"',
  "$HOME & file",
  "a;echo sentinel",
  "$(printf sentinel)",
  "`printf sentinel`",
  "[draft]*?",
  "a\\b",
  "#comment",
  "~home",
  "=ls",
  "café/日本語",
  "it’s here",
  "‘quoted’",
  "line\nbreak",
  "it's\na file",
];
it.each(names)("round trips shell syntax for %s on both platforms", (name) => {
  for (const windows of [false, true]) {
    expect(unescapeForShell(escapeForShell(name, windows), windows)).toBe(name);
  }
});

for (const shell of ["bash", "zsh", "pwsh", "powershell"]) {
  const windows = shell === "pwsh" || shell === "powershell";
  const available =
    spawnSync(
      shell,
      windows ? ["-NoProfile", "-Command", "exit 0"] : ["-c", "exit 0"],
    ).status === 0;
  describe.skipIf(!available)(`literal arguments in ${shell}`, () => {
    it.each(names)("preserves %s as exactly one argument", (name) => {
      const escaped = escapeForShell(name, windows);
      expect(unescapeForShell(escaped, windows)).toBe(name);
      if (windows) {
        const result = execFileSync(
          shell,
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); function capture { ConvertTo-Json -Compress -InputObject @($args) }; capture ${escaped}`,
          ],
          { encoding: "utf8" },
        );
        expect(JSON.parse(result.replace(/^\uFEFF/, ""))).toEqual([name]);
      } else {
        const result = execFileSync(shell, ["-s"], {
          input: `printf '%s\\0' ${escaped}\n`,
          encoding: "utf8",
        });
        expect(result).toBe(`${name}\0`);
      }
    });
  });
}
