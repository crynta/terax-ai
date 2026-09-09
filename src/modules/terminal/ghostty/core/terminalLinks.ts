export type TerminalTextLink = { start: number; end: number; uri: string };

export function detectTerminalLinks(text: string): TerminalTextLink[] {
  const links: TerminalTextLink[] = [];
  const pattern = /(?:https?:\/\/|mailto:)[^\s<>"'`\u0000-\u001f\u007f]+/giu;
  for (
    let match = pattern.exec(text);
    match && links.length < 256;
    match = pattern.exec(text)
  ) {
    let uri = match[0].replace(/[.,;:!?]+$/, "");
    const balance = [0, 0, 0];
    const opens = "([{",
      closes = ")]}";
    for (let index = 0; index < uri.length; index++) {
      const open = opens.indexOf(uri[index]);
      const close = closes.indexOf(uri[index]);
      if (open >= 0) balance[open]++;
      if (close >= 0) balance[close]--;
    }
    let end = uri.length;
    while (end > 0) {
      const close = closes.indexOf(uri[end - 1]);
      if (close < 0 || balance[close] >= 0) break;
      balance[close]++;
      end--;
    }
    uri = uri.slice(0, end);
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== "mailto:" && !parsed.hostname) continue;
      links.push({ start: match.index, end: match.index + uri.length, uri });
    } catch {
      /* Incomplete URLs stay ordinary terminal text. */
    }
  }
  return links;
}
