import { describe, expect, it } from "vitest";
import { quoteShellArg } from "./shellQuote";

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
