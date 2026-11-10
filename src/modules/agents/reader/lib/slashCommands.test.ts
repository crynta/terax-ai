import { describe, expect, it } from "vitest";
import {
  applySuggestion,
  BUILTIN_COMMANDS,
  findTrigger,
  rankCommands,
  type SlashCommand,
} from "./slashCommands";

describe("findTrigger", () => {
  it("opens commands only for a leading slash with no space yet", () => {
    expect(findTrigger("/", 1)).toEqual({
      kind: "slash",
      query: "",
      start: 0,
      end: 1,
    });
    expect(findTrigger("/com", 4)).toMatchObject({
      kind: "slash",
      query: "com",
    });
    expect(findTrigger("/m-skills:pr", 12)).toMatchObject({
      query: "m-skills:pr",
    });
    expect(findTrigger("/compact now", 12)).toBeNull();
    expect(findTrigger("say /hi", 7)).toBeNull();
  });

  it("finds an @ mention at the caret but not inside words", () => {
    expect(findTrigger("look at @src/ap", 15)).toEqual({
      kind: "mention",
      query: "src/ap",
      start: 8,
      end: 15,
    });
    expect(findTrigger("@", 1)).toMatchObject({ kind: "mention", query: "" });
    expect(findTrigger("mail me@host", 12)).toBeNull();
    expect(findTrigger("@a.ts done", 10)).toBeNull();
  });
});

describe("rankCommands", () => {
  const custom: SlashCommand[] = [
    { name: "m-skills:pr", description: "Raise a PR", source: "plugin" },
    { name: "compact-notes", description: "Notes", source: "user" },
    { name: "deploy", description: "Ship to staging", source: "project" },
  ];
  const all = [...BUILTIN_COMMANDS, ...custom];

  it("puts prefix matches and built-ins first", () => {
    const top = rankCommands("comp", all).map((c) => c.name);
    expect(top[0]).toBe("compact");
    expect(top).toContain("compact-notes");
  });

  it("matches fuzzily and by description", () => {
    expect(rankCommands("mspr", all)[0].name).toBe("m-skills:pr");
    expect(rankCommands("staging", all).map((c) => c.name)).toContain("deploy");
  });

  it("lists built-ins first and caps the list when the query is empty", () => {
    const list = rankCommands("", all, 5);
    expect(list).toHaveLength(5);
    expect(list.every((c) => c.source === "builtin")).toBe(true);
  });
});

function at(text: string, caret: number) {
  const trigger = findTrigger(text, caret);
  if (!trigger) throw new Error(`no trigger in ${text}`);
  return trigger;
}

describe("applySuggestion", () => {
  it("completes a command with a trailing space", () => {
    expect(applySuggestion("/comp", at("/comp", 5), "compact")).toEqual({
      text: "/compact ",
      caret: 9,
    });
  });

  it("completes a file mention in the middle of a message", () => {
    const text = "see @src/a and more";
    expect(applySuggestion(text, at(text, 10), "src/app.ts")).toEqual({
      text: "see @src/app.ts and more",
      caret: 15,
    });
  });

  it("keeps searching inside a folder", () => {
    expect(
      applySuggestion("@sr", at("@sr", 3), "src", { folder: true }),
    ).toEqual({
      text: "@src/",
      caret: 5,
    });
  });
});
