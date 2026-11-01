export type SaveDecision = "write" | "conflict";

/// Decides whether a save may overwrite the file on disk. An mtime bump with
/// identical content (touch, sync tools, formatters) is not a real conflict.
/// `diskText` is the LF-normalized disk content, or null when it could not be
/// read as text.
export function decideSave(input: {
  knownMtime: number | null;
  statMtime: number | null;
  diskText: string | null;
  savedText: string;
}): SaveDecision {
  const { knownMtime, statMtime, diskText, savedText } = input;
  if (knownMtime === null || statMtime === null) return "write";
  if (statMtime === knownMtime) return "write";
  return diskText === savedText ? "write" : "conflict";
}
