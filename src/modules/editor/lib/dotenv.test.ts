import { StringStream } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { dotenv } from "./dotenv";

function tokenizeLine(line: string): Array<[string, string]> {
  const state = dotenv.startState?.(2);
  if (!state) throw new Error("dotenv parser has no start state");

  const stream = new StringStream(line, 2, 2);
  const tokens: Array<[string, string]> = [];

  while (!stream.eol()) {
    stream.start = stream.pos;
    const style = dotenv.token(stream, state);
    if (stream.pos === stream.start) {
      throw new Error(`Parser did not advance at ${stream.pos}`);
    }
    if (style) tokens.push([stream.current(), style]);
  }

  return tokens;
}

describe("dotenv tokenizer", () => {
  it("highlights exports, keys, values, and comments", () => {
    expect(tokenizeLine("export API_URL=https://example.com # public")).toEqual(
      [
        ["export", "keyword"],
        ["API_URL", "variableName.definition"],
        ["=", "operator"],
        ["https://example.com", "string"],
        ["# public", "comment"],
      ],
    );
  });

  it("highlights variables inside double quoted values", () => {
    const variableRef = "$" + "{DB_HOST}";

    expect(
      tokenizeLine(`DATABASE_URL="postgres://${variableRef}:5432/app"`),
    ).toEqual([
      ["DATABASE_URL", "variableName.definition"],
      ["=", "operator"],
      ['"', "string"],
      ["postgres://", "string"],
      [variableRef, "variableName.special"],
      [":5432/app", "string"],
      ['"', "string"],
    ]);
  });

  it("keeps hashes inside unquoted values", () => {
    expect(tokenizeLine("PASSWORD=abc#123")).toEqual([
      ["PASSWORD", "variableName.definition"],
      ["=", "operator"],
      ["abc#123", "string"],
    ]);
  });

  it("keeps hashes at the start of unquoted values", () => {
    expect(tokenizeLine("KEY=#hash")).toEqual([
      ["KEY", "variableName.definition"],
      ["=", "operator"],
      ["#hash", "string"],
    ]);
  });

  it("highlights comments after empty values", () => {
    expect(tokenizeLine("KEY= #comment")).toEqual([
      ["KEY", "variableName.definition"],
      ["=", "operator"],
      ["#comment", "comment"],
    ]);
  });
});
