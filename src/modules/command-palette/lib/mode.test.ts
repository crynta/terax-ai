import { describe, expect, it } from "vitest";
import { parseQuery } from "./mode";

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
});
