import { turnMarkdown } from "./readerDoc";
import type { ReaderDocument } from "./transcript";

export type ExportMeta = {
  title: string;
  cwd: string | null;
  sessionId: string | null;
  /** When the export was made, as epoch ms. */
  exportedAt: number;
};

function isoMinute(at: number | string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return String(at);
  return date.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * The whole conversation as Markdown: a title block, then each turn as a
 * section with the prompt, Claude's replies and a one-line summary per tool.
 */
export function documentMarkdown(
  doc: ReaderDocument,
  meta: ExportMeta,
): string {
  const lines: string[] = [`# ${meta.title}`, ""];
  const facts = [
    meta.cwd ? `Folder: \`${meta.cwd}\`` : null,
    meta.sessionId ? `Session: \`${meta.sessionId}\`` : null,
    `Exported: ${isoMinute(meta.exportedAt)} UTC`,
    `Turns: ${doc.turns.length}`,
  ].filter(Boolean);
  lines.push(facts.join("  \n"), "");
  doc.turns.forEach((turn, index) => {
    const when = turn.promptAt ? ` · ${isoMinute(turn.promptAt)}` : "";
    lines.push(`## Turn ${index + 1}${when}`, "", turnMarkdown(turn), "");
  });
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

/** A file name for the export: the title in kebab case plus the date. */
export function exportFileName(title: string, exportedAt: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const day = new Date(exportedAt).toISOString().slice(0, 10);
  return `${slug || "claude-chat"}-${day}.md`;
}
