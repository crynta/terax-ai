import { shellQuoteChar } from "@/lib/shellQuote";

export type ShellWord = { start: number; end: number; text: string };

/** Keep the entire argument range so accepting inside quotes also replaces its closing quote. */
export function shellWordAt(
  input: string,
  pos: number,
  windows: boolean,
): ShellWord {
  let start = 0;
  let quote = "";
  const escapeChar = windows ? "`" : "\\";
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const delimiter = shellQuoteChar(c, windows);
    if (quote && delimiter === quote) {
      if (windows && shellQuoteChar(input[i + 1] ?? "", windows) === quote) i++;
      else quote = "";
    } else if (quote !== "'" && c === escapeChar) {
      if (!quote || windows || '$`"\\\n'.includes(input[i + 1] ?? "")) i++;
    } else if (!quote && delimiter) {
      quote = delimiter;
    } else if (!quote && /[\s;&|<>(){}]/.test(c)) {
      if (i >= pos) return { start, end: i, text: input.slice(start, pos) };
      start = i + 1;
    }
  }
  return { start, end: input.length, text: input.slice(start, pos) };
}
