// Models frequently answer in tab or 4-space style regardless of the file.
// Conversion is only applied when unambiguous: tab-led lines into a space
// file, or space-led lines into a tab file. Space-width remapping between
// space files is ambiguous (4 spaces may be one level or two) and is left
// to the prompt.
export function normalizeIndent(text: string, unit: string): string {
  if (!text.includes("\n")) return text;
  const lines = text.split("\n");
  const fileUsesTabs = unit === "\t";

  const leads = lines
    .slice(1)
    .map((l) => /^[\t ]*/.exec(l)?.[0] ?? "")
    .filter((w) => w.length > 0);
  if (leads.length === 0) return text;
  const hasTabLeads = leads.some((w) => w.includes("\t"));

  if (!fileUsesTabs && hasTabLeads) {
    return lines
      .map((l, i) =>
        i === 0 ? l : l.replace(/^[\t ]+/, (ws) => ws.replace(/\t/g, unit)),
      )
      .join("\n");
  }

  if (fileUsesTabs && !hasTabLeads) {
    const widths = leads.map((w) => w.length);
    const spaceUnit = [8, 4, 2].find((u) => widths.every((n) => n % u === 0));
    if (!spaceUnit) return text;
    return lines
      .map((l, i) =>
        i === 0
          ? l
          : l.replace(/^ +/, (ws) => "\t".repeat(ws.length / spaceUnit)),
      )
      .join("\n");
  }

  return text;
}
