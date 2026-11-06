import { describe, expect, it } from "vitest";
import { isClaudeCommand, OscSignalParser } from "../src/osc";

const ID = "0b6c2a1e-3f4d-4e5a-9b8c-7d6e5f4a3b2c";
const hook = (event: string, id?: string) =>
  `\x1b]777;notify;Terax;claude;${event}${id ? `;${id}` : ""}\x07`;

describe("OscSignalParser", () => {
  it("links the session and reports attention and finish", () => {
    const p = new OscSignalParser(() => 0);
    expect(p.feed(`text ${hook("attention", ID)} more`)).toEqual([
      { kind: "linked", session: ID },
      { kind: "attention" },
    ]);
    expect(p.feed(hook("working", ID))).toEqual([{ kind: "working" }]);
    expect(p.feed(hook("finished", ID))).toEqual([{ kind: "finished" }]);
  });

  it("parses markers split across chunks and ST-terminated", () => {
    const p = new OscSignalParser(() => 0);
    const seq = `\x1b]777;notify;Terax;claude;attention;${ID}\x1b\\`;
    expect(p.feed(seq.slice(0, 10))).toEqual([]);
    expect(p.feed(seq.slice(10))).toEqual([
      { kind: "linked", session: ID },
      { kind: "attention" },
    ]);
  });

  it("drops a malformed session id but keeps the event", () => {
    const p = new OscSignalParser(() => 0);
    expect(p.feed(hook("finished", "not-a-uuid"))).toEqual([{ kind: "finished" }]);
  });

  it("ignores unknown agents and events", () => {
    const p = new OscSignalParser(() => 0);
    expect(p.feed("\x1b]777;notify;Terax;evil;attention\x07")).toEqual([]);
    expect(p.feed(hook("bogus"))).toEqual([]);
  });

  it("debounces repeated generic attention", () => {
    let now = 0;
    const p = new OscSignalParser(() => now);
    expect(p.feed("\x1b]9;hello\x07")).toEqual([{ kind: "attention" }]);
    now = 1000;
    expect(p.feed("\x1b]9;hello\x07")).toEqual([]);
    expect(p.feed("\x1b]9;4;1;50\x07")).toEqual([]);
  });
});

describe("isClaudeCommand", () => {
  it("matches claude runs", () => {
    expect(isClaudeCommand("claude")).toBe(true);
    expect(isClaudeCommand("claude --resume x")).toBe(true);
    expect(isClaudeCommand("~/bin/claude")).toBe(true);
    expect(isClaudeCommand("npx claude-code")).toBe(true);
    expect(isClaudeCommand("cat claude.md")).toBe(false);
    expect(isClaudeCommand("git status")).toBe(false);
  });
});
