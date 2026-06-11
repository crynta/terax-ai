export function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]*[.!?]+[\s"]*/g);
  if (!matches) return text.length > 0 ? [text] : [];
  const trailing = text.slice(matches.reduce((acc, m) => acc + m.length, 0));
  const result = [...matches];
  if (trailing.trim()) result.push(trailing);
  return result.filter((s) => s.trim().length > 0);
}
