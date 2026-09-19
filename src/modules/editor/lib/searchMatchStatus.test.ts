import { SearchQuery, search, setSearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { editorSearchMatchStatus } from "./searchMatchStatus";

function stateWith(doc: string, query: string, from: number, to: number) {
  return EditorState.create({
    doc,
    selection: { anchor: from, head: to },
    extensions: [search()],
  }).update({
    effects: setSearchQuery.of(
      new SearchQuery({ search: query, caseSensitive: false }),
    ),
  }).state;
}

describe("editorSearchMatchStatus", () => {
  it("counts matches and the selected hit", () => {
    const first = stateWith("foo bar foo", "foo", 0, 3);
    expect(editorSearchMatchStatus(first)).toEqual({
      current: 1,
      total: 2,
      complete: true,
    });
    const second = stateWith("foo bar foo", "foo", 8, 11);
    expect(editorSearchMatchStatus(second)).toEqual({
      current: 2,
      total: 2,
      complete: true,
    });
  });

  it("reports a completed miss", () => {
    expect(editorSearchMatchStatus(stateWith("foo", "zzz", 0, 0))).toEqual({
      current: 0,
      total: 0,
      complete: true,
    });
  });

  it("ignores an empty query", () => {
    expect(editorSearchMatchStatus(stateWith("foo", "", 0, 0))).toEqual({
      current: 0,
      total: 0,
      complete: true,
    });
  });
});
