import { describe, expect, it } from "vitest";
import { escapeForShell, quoteShellArg, unescapeForShell } from "./shellQuote";

describe("quoteShellArg (posix)", () => {
  const q = (s: string) => quoteShellArg(s, false);

  it("wraps a plain string in single quotes", () => {
    expect(q("fix the bug")).toBe("'fix the bug'");
  });

  it("escapes embedded single quotes with the '\\'' dance", () => {
    expect(q("it's broken")).toBe("'it'\\''s broken'");
  });

  it("neutralizes shell metacharacters", () => {
    expect(q("a; rm -rf / $(whoami) `id` && b")).toBe(
      "'a; rm -rf / $(whoami) `id` && b'",
    );
  });

  it("quotes an empty string to a real empty argument", () => {
    expect(q("")).toBe("''");
  });

  it("cannot break out of the quoted argument", () => {
    expect(q("'; rm -rf /; '")).toBe("''\\''; rm -rf /; '\\'''");
  });
});

describe("quoteShellArg (windows/pwsh)", () => {
  const q = (s: string) => quoteShellArg(s, true);

  it("wraps a plain string in single quotes", () => {
    expect(q("fix the bug")).toBe("'fix the bug'");
  });

  it("doubles embedded single quotes", () => {
    expect(q("it's broken")).toBe("'it''s broken'");
  });

  it("keeps backticks and $ literal inside single quotes", () => {
    expect(q("$env:PATH `n")).toBe("'$env:PATH `n'");
  });

  it("quotes an empty string", () => {
    expect(q("")).toBe("''");
  });
});

describe("escapeForShell", () => {
  it("leaves plain paths untouched", () => {
    expect(escapeForShell("/a/b/c.ts", false)).toBe("/a/b/c.ts");
  });

  it("escapes spaces so the path stays one argument", () => {
    expect(escapeForShell("/a/My Folder/c.ts", false)).toBe(
      "/a/My\\ Folder/c.ts",
    );
  });

  it("escapes shell syntax inside names", () => {
    expect(escapeForShell("/a/b $HOME & c", false)).toBe(
      "/a/b\\ \\$HOME\\ \\&\\ c",
    );
    expect(escapeForShell("/a/[draft] *", false)).toBe("/a/\\[draft\\]\\ \\*");
  });

  it("escapes a literal backslash so it is not read as an escape", () => {
    expect(escapeForShell("/a/b\\ c", false)).toBe("/a/b\\\\\\ c");
  });

  it("quotes with a PowerShell literal on Windows, where backslash is a separator", () => {
    expect(escapeForShell("C:\\a\\My Folder\\c.ts", true)).toBe(
      "'C:\\a\\My Folder\\c.ts'",
    );
    expect(escapeForShell("C:\\a\\c.ts", true)).toBe("C:\\a\\c.ts");
  });

  it.each([
    ["semicolon", "C:\\a\\b;c"],
    ["dollar sign", "C:\\a\\$env:USERPROFILE"],
    ["backtick", "C:\\a\\b`nc"],
    ["percent sign", "C:\\a\\%TEMP%"],
    ["command separator", "C:\\a\\b & c"],
  ])(
    "quotes a Windows path containing a %s so it stays literal",
    (_label, path) => {
      const escaped = escapeForShell(path, true);
      expect(escaped).toBe(`'${path}'`);
    },
  );

  it("doubles apostrophes inside a Windows literal", () => {
    expect(escapeForShell("C:\\a\\it's here.txt", true)).toBe(
      "'C:\\a\\it''s here.txt'",
    );
    expect(escapeForShell("C:\\a\\'quoted'.txt", true)).toBe(
      "'C:\\a\\''quoted''.txt'",
    );
  });

  it("keeps double quotes inside a Windows literal verbatim", () => {
    expect(escapeForShell('C:\\a\\say "hi".txt', true)).toBe(
      "'C:\\a\\say \"hi\".txt'",
    );
  });

  it("keeps empty input empty", () => {
    expect(escapeForShell("", false)).toBe("");
  });
});

describe("unescapeForShell", () => {
  it("leaves plain text untouched", () => {
    expect(unescapeForShell("My Folder", false)).toBe("My Folder");
    expect(unescapeForShell("C:\\a\\b", true)).toBe("C:\\a\\b");
  });

  it("turns backslash escapes back into the names they came from", () => {
    expect(unescapeForShell("My\\ Folder", false)).toBe("My Folder");
    expect(unescapeForShell("\\$HOME\\ \\&\\ c", false)).toBe("$HOME & c");
  });

  it("does not let a filename's escaped backslash eat the next character", () => {
    expect(unescapeForShell("a\\\\b", false)).toBe("a\\b");
    expect(unescapeForShell("b\\\\\\ c", false)).toBe("b\\ c");
  });

  it("keeps separators while unescaping every segment", () => {
    expect(unescapeForShell("My\\ Folder/sub\\ dir/", false)).toBe(
      "My Folder/sub dir/",
    );
  });

  it("strips Windows single-quoted segments and undoubles apostrophes", () => {
    expect(unescapeForShell("'My Folder'/sub", true)).toBe("My Folder/sub");
    expect(unescapeForShell("'it''s here.txt'", true)).toBe("it's here.txt");
    expect(unescapeForShell("C:\\a\\c.ts", true)).toBe("C:\\a\\c.ts");
  });

  it("round-trips what escapeForShell writes", () => {
    for (const name of [
      "My Folder",
      "it's here.txt",
      "$HOME & c",
      "[draft] *",
      "b\\ c",
      "plain.ts",
    ]) {
      expect(unescapeForShell(escapeForShell(name, false), false)).toBe(name);
      expect(unescapeForShell(escapeForShell(name, true), true)).toBe(name);
    }
  });

  it("keeps empty input empty", () => {
    expect(unescapeForShell("", false)).toBe("");
  });
});
