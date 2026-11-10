/**
 * ↑/↓ prompt history in the composer, like a shell: the session's earlier
 * prompts plus ones sent from here, newest last. Pure.
 */

export type HistoryNav = {
  entries: readonly string[];
  /** Position in `entries` being shown, or null while editing the draft. */
  index: number | null;
  /** The text that was in the box before browsing started. */
  draft: string;
};

const MAX_ENTRIES = 200;

/**
 * History entries, oldest first: transcript prompts then locally sent ones,
 * trimmed, without blanks or immediate repeats, at most 200.
 */
export function buildHistory(
  transcript: readonly (string | null)[],
  local: readonly string[] = [],
): string[] {
  const out: string[] = [];
  for (const raw of [...transcript, ...local]) {
    const text = raw?.trim();
    if (!text) continue;
    if (out[out.length - 1] === text) continue;
    out.push(text);
  }
  return out.slice(-MAX_ENTRIES);
}

export function startNav(
  entries: readonly string[],
  draft: string,
): HistoryNav {
  return { entries, index: null, draft };
}

/** One step older; null when there is nothing older. */
export function historyUp(
  nav: HistoryNav,
): { nav: HistoryNav; text: string } | null {
  if (nav.entries.length === 0) return null;
  const index = nav.index === null ? nav.entries.length - 1 : nav.index - 1;
  if (index < 0) return null;
  return { nav: { ...nav, index }, text: nav.entries[index] };
}

/** One step newer; past the newest returns to the draft. Null when not browsing. */
export function historyDown(
  nav: HistoryNav,
): { nav: HistoryNav; text: string } | null {
  if (nav.index === null) return null;
  const index = nav.index + 1;
  if (index >= nav.entries.length) {
    return { nav: { ...nav, index: null }, text: nav.draft };
  }
  return { nav: { ...nav, index }, text: nav.entries[index] };
}

/** Leaves history browsing, restoring the draft. */
export function historyEscape(nav: HistoryNav): {
  nav: HistoryNav;
  text: string;
} {
  return { nav: { ...nav, index: null }, text: nav.draft };
}

/**
 * Whether ↑ should browse history rather than move the caret: the box is
 * empty, already browsing, or the caret sits at the very start.
 */
export function shouldBrowseUp(
  text: string,
  caret: number,
  browsing: boolean,
): boolean {
  return browsing || text.length === 0 || (caret === 0 && !text.includes("\n"));
}
