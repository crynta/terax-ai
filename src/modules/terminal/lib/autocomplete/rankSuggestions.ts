const MAX_SUGGESTIONS = 12;

export function rankSuggestions(
  prefix: string,
  historyMatches: readonly string[],
  staticLines: readonly string[],
): string[] {
  if (prefix.length === 0) return [];
  const pl = prefix.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (s: string) => {
    const t = s.trim();
    if (t.length <= prefix.length) return;
    if (!t.toLowerCase().startsWith(pl)) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };

  for (const h of historyMatches) push(h);
  for (const s of staticLines) push(s);

  return out.slice(0, MAX_SUGGESTIONS);
}
