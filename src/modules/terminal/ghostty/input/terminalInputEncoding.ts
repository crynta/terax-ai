export function normalizeTerminalPaste(text: string): string {
  return text.replace(/\r\n|\r|\n/g, "\r");
}

export function encodeTerminalPaste(
  text: string,
  bracketedPaste: boolean,
): string {
  const normalized = normalizeTerminalPaste(text);
  if (!bracketedPaste) return normalized;
  return `\x1b[200~${normalized.split("\x1b").join("␛")}\x1b[201~`;
}

export function encodeTerminalSubmission(
  text: string,
  bracketedPaste: boolean,
): string {
  const normalized = normalizeTerminalPaste(text);
  const payload = normalized.includes("\r")
    ? encodeTerminalPaste(normalized, bracketedPaste)
    : normalized;
  return `${payload}\r`;
}
