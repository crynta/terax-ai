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
  if (
    accepted &&
    (bytes.includes(13) ||
      bytes.includes(10) ||
      (bytes[0] === 27 &&
        /\x1b\[(?:13(?:;[\d:]+)*u|27;\d+;13~)/.test(
          new TextDecoder().decode(bytes),
        )))
  )
    session.commandTracked = false;
  return accepted;
}
