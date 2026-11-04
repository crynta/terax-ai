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
  return detectPathLinks(text, links);
}

const PATH_PATTERN =
  /(?:(?:~|\.{1,2})?\/)?[\w.@+%=~-]+(?:\/[\w.@+%=~-]+)*(?::\d+(?::\d+)?)?/gu;
const PATH_BOUNDARY = /[\w./~:@%+=-]/u;
const PATH_EXTENSION = /\.[A-Za-z][\w-]{0,15}$/u;

/**
 * Adds file paths (`/abs/a.ts`, `./a.ts`, `~/a.md`, `src/a.ts:12:3`) to `urls`, skipping any
 * that overlap a URL. A relative path needs a slash and a file extension so prose like
 * "and/or" or "2026/10/27" stays plain text. The link's uri is the path text as printed.
 */
function detectPathLinks(
  text: string,
  urls: TerminalTextLink[],
): TerminalTextLink[] {
  const links = [...urls];
  PATH_PATTERN.lastIndex = 0;
  for (
    let match = PATH_PATTERN.exec(text);
    match && links.length < 256;
    match = PATH_PATTERN.exec(text)
  ) {
    const start = match.index;
    if (start > 0 && PATH_BOUNDARY.test(text[start - 1])) continue;
    const raw = match[0].replace(/\.+$/, "");
    const path = raw.replace(/:\d+(?::\d+)?$/, "");
    const anchored = /^(?:~|\.{1,2})?\//.test(path);
    if (!path.includes("/") || /^(?:~|\.{1,2})?\/*$/.test(path)) continue;
    if (!anchored && !PATH_EXTENSION.test(path)) continue;
    const end = start + raw.length;
    if (urls.some((url) => start < url.end && end > url.start)) continue;
    links.push({ start, end, uri: raw });
  }
  return links.sort((a, b) => a.start - b.start);
}
