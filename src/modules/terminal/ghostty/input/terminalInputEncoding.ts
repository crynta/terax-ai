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
  const payload =
    normalized.includes("\r") || normalized.includes("\x1b")
      ? encodeTerminalPaste(normalized, bracketedPaste)
      : normalized;
  return `${payload}\r`;
}
/** Revoke prompt readiness before queued input can start a command. */
export function enqueueTerminalInput(
  session: {
    commandTracked: boolean;
    writer: { enqueue(bytes: Uint8Array): boolean };
  },
  bytes: Uint8Array,
): boolean {
  const accepted = session.writer.enqueue(bytes);
  if (!accepted) return false;
  let submitted = bytes.includes(13) || bytes.includes(10);
  if (!submitted && bytes[0] === 27) {
    const sequence = new TextDecoder().decode(bytes);
    const kitty =
      /\x1b\[13(?::[\d:]*)?(?:;\d*(?::([123]))?)?(?:;[\d:]+)?u/.exec(sequence);
    submitted =
      (kitty !== null && kitty[1] !== "3") || /\x1b\[27;\d+;13~/.test(sequence);
  }
  if (submitted) session.commandTracked = false;
  return accepted;
}
