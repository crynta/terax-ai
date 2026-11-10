/**
 * Searching a session by what the user asked: every prompt in its transcript,
 * ranked against a query. Prompts holding the query come first; prompts that
 * share several of its words follow as related ones.
 */
import { findMatches } from "./readerDoc";

/** One prompt of a session, as `agent_transcript_prompts` lists them. */
export type SessionPrompt = { uuid: string; at: string | null; text: string };

export type PromptHit = {
  prompt: SessionPrompt;
  /** The prompt's place in the session, from 0. */
  index: number;
  /** Shares words with the query rather than holding it. */
  related: boolean;
  /** One line around the match, split to highlight it. */
  snippet: { before: string; match: string; after: string };
};

const STOP_WORDS = new Set(
  "a an and are as at be but by can do does for from how i if in is it its me my of on or so that the this to was we what when where which why with you your".split(
    " ",
  ),
);

/** The words of `query` worth matching: lowercase, 2+ letters, no stop words. */
export function queryWords(query: string): string[] {
  const words = query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  return [...new Set(words.filter((w) => !STOP_WORDS.has(w)))];
}

const SNIPPET_CONTEXT = 48;

function snippetAt(
  line: string,
  at: number,
  length: number,
): PromptHit["snippet"] {
  const start = Math.max(0, at - SNIPPET_CONTEXT);
  const end = Math.min(line.length, at + length + SNIPPET_CONTEXT * 2);
  return {
    before: `${start > 0 ? "…" : ""}${line.slice(start, at).trimStart()}`,
    match: line.slice(at, at + length),
    after: `${line.slice(at + length, end).trimEnd()}${end < line.length ? "…" : ""}`,
  };
}

/** Where a prompt word starts with `word`, or -1. */
function wordStart(lower: string, word: string): number {
  let at = lower.indexOf(word);
  while (at !== -1) {
    if (at === 0 || !/[\p{L}\p{N}_]/u.test(lower[at - 1])) return at;
    at = lower.indexOf(word, at + 1);
  }
  return -1;
}

/**
 * The prompts matching `query`: those holding it, newest first, then those
 * sharing at least two of its words (a word matching the start of a prompt's
 * word, so "deploy" finds "deployment"), most shared words first.
 */
export function rankPrompts(
  prompts: readonly SessionPrompt[],
  query: string,
  limit = 50,
): PromptHit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const words = queryWords(q);
  const exact: PromptHit[] = [];
  const related: (PromptHit & { shared: number })[] = [];
  prompts.forEach((prompt, index) => {
    const line = prompt.text.replace(/\s+/g, " ").trim();
    const at = findMatches(line, q)[0];
    if (at !== undefined) {
      exact.push({
        prompt,
        index,
        related: false,
        snippet: snippetAt(line, at, q.length),
      });
      return;
    }
    if (words.length < 2) return;
    const lower = line.toLocaleLowerCase();
    let first = -1;
    let firstWord = "";
    let shared = 0;
    for (const word of words) {
      const start = wordStart(lower, word);
      if (start === -1) continue;
      shared += 1;
      if (first === -1 || start < first) {
        first = start;
        firstWord = word;
      }
    }
    if (shared < 2) return;
    related.push({
      prompt,
      index,
      related: true,
      shared,
      snippet: snippetAt(line, first, firstWord.length),
    });
  });
  exact.reverse();
  related.sort((a, b) => b.shared - a.shared || b.index - a.index);
  return [
    ...exact,
    ...related.map(({ shared: _shared, ...hit }) => hit),
  ].slice(0, limit);
}
