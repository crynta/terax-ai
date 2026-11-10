import { describe, expect, it } from "vitest";
import {
  matchesQuery,
  queryWords,
  rankPrompts,
  type SessionPrompt,
} from "./promptSearch";

const prompts: SessionPrompt[] = [
  "deploy the fluss tiering job to staging",
  "why is the tablet server crashing",
  "check the deployment of fluss on prd",
  "Fluss tiering is slow, can you look",
  "write the runbook",
].map((text, i) => ({ uuid: `u${i}`, at: null, text }));

describe("rankPrompts", () => {
  it("lists prompts holding the query first, newest first", () => {
    const hits = rankPrompts(prompts, "fluss tiering");
    expect(hits.map((h) => [h.prompt.uuid, h.related])).toEqual([
      ["u3", false],
      ["u0", false],
    ]);
    expect(hits[0].snippet).toEqual({ before: "", match: "Fluss tiering", after: " is slow, can you look" });
  });

  it("adds related prompts sharing two words, by word prefix", () => {
    const hits = rankPrompts(prompts, "deploy fluss");
    expect(hits.map((h) => [h.prompt.uuid, h.related])).toEqual([
      ["u2", true],
      ["u0", true],
    ]);
    expect(hits[0].snippet.match).toBe("deploy");
  });

  it("ignores stop words and too-short queries", () => {
    expect(queryWords("why is THE tablet crashing")).toEqual(["tablet", "crashing"]);
    expect(rankPrompts(prompts, "x")).toEqual([]);
    expect(rankPrompts(prompts, "the runbook").map((h) => h.prompt.uuid)).toEqual(["u4"]);
  });

  it("keeps a long prompt's snippet to the words around the match", () => {
    const long = [{ uuid: "l", at: null, text: `${"word ".repeat(40)}needle${" tail".repeat(40)}` }];
    const [hit] = rankPrompts(long, "needle");
    expect(hit.snippet.before.startsWith("…")).toBe(true);
    expect(hit.snippet.after.endsWith("…")).toBe(true);
    expect(hit.snippet.before.length).toBeLessThan(60);
  });
});

describe("matchesQuery", () => {
  const text = "Deploy the reader build to staging\nthen check the logs";

  it("matches everything for an empty query", () => {
    expect(matchesQuery(text, "  ")).toBe(true);
  });

  it("matches a phrase anywhere, ignoring case", () => {
    expect(matchesQuery(text, "READER BUILD")).toBe(true);
    expect(matchesQuery(text, "check the logs")).toBe(true);
  });

  it("matches word starts in any order", () => {
    expect(matchesQuery(text, "logs deploy")).toBe(true);
    expect(matchesQuery(text, "stag dep")).toBe(true);
  });

  it("needs every word", () => {
    expect(matchesQuery(text, "deploy production")).toBe(false);
    expect(matchesQuery(text, "eader")).toBe(true);
    expect(matchesQuery(text, "eader uild")).toBe(false);
  });
});
