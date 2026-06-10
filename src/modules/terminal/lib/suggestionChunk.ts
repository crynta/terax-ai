/**
 * Partial-accept boundary for inline suggestions. Mirrors zsh-autosuggestions'
 * `forward-word`: accept the suggestion one token at a time instead of all of
 * it. A chunk is the leading run of separators (spaces, slashes, dashes, etc.)
 * followed by the next run of word characters, so accepting once on
 * ` status --short` yields ` status` and leaves ` --short`.
 */
export function nextSuggestionChunk(remainder: string): string {
  if (!remainder) return "";
  const m = remainder.match(/^[\s/\-_.=:,]*[^\s/\-_.=:,]+/);
  // Fallback to the whole remainder when it is only separators.
  return m ? m[0] : remainder;
}
