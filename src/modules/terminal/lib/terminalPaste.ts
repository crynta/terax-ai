export type TerminalPasteTarget = {
  paste: (text: string) => void;
  focus: () => void;
};

export function pasteIntoTerminal(
  terminal: TerminalPasteTarget | null,
  text: string,
): boolean {
  if (!terminal) return false;
  terminal.paste(text);
  terminal.focus();
  return true;
}
