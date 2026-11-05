import { describe, expect, it } from "vitest";
import { MODE_HINTS, parseQuery } from "./mode";

describe("parseQuery", () => {
  it("defaults to commands mode with a trimmed term", () => {
    expect(parseQuery("  foo ")).toEqual({
      mode: "commands",
      term: "foo",
      raw: "  foo ",
    });
  });

  it("routes > to command history", () => {
    expect(parseQuery(">git")).toMatchObject({ mode: "history", term: "git" });
  });

  it("routes # to content search", () => {
    expect(parseQuery("# useState")).toMatchObject({
      mode: "content",
      term: "useState",
    });
  });

  it("routes ? to help", () => {
    expect(parseQuery("?")).toMatchObject({ mode: "help", term: "" });
  });

  it("routes / to files from the commands base", () => {
    expect(parseQuery("/ app.tsx")).toMatchObject({
      mode: "files",
      term: "app.tsx",
    });
  });

  it("treats a plain query as files from the files base", () => {
    expect(parseQuery(" App.tsx:12 ", "files")).toMatchObject({
      mode: "files",
      term: "App.tsx:12",
    });
  });

  it("keeps the other sigils working from the files base", () => {
    expect(parseQuery(">git", "files")).toMatchObject({ mode: "history" });
    expect(parseQuery("#todo", "files")).toMatchObject({
      mode: "content",
      term: "todo",
    });
  });

  it("does not steal a leading slash from the files base", () => {
    expect(parseQuery("/src", "files")).toMatchObject({
      mode: "files",
      term: "/src",
    });
  });
});

describe("MODE_HINTS", () => {
  it("only offers the files hint where the sigil is recognised", () => {
    const hintFor = (base: "commands" | "files") =>
      MODE_HINTS.filter((h) => h.bases.includes(base)).map((h) => h.sigil);
    expect(hintFor("commands")).toContain("/");
    expect(hintFor("files")).not.toContain("/");
  });
});
