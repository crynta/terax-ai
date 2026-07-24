export type SplitResult = {
  entries: [string, string][];
  body: string;
};

// Leading BOM tolerated; the block must start on the very first line, like on
// GitHub. Closing fence may be the last line of the file.
const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const KEY_RE = /^([A-Za-z0-9_][\w.-]*):(?:[ \t]+(.*))?$/;

// GitHub renders a leading YAML frontmatter block as a table with one
// key/value row per entry; anything not a flat mapping stays in the body.
export function splitFrontmatter(content: string): SplitResult {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return { entries: [], body: content };
  const entries = parseMapping(m[1]);
  if (!entries || entries.length === 0) return { entries: [], body: content };
  return { entries, body: content.slice(m[0].length) };
}

// Hand-rolled YAML subset: a real YAML dep is ~25 kB gzip against the size
// budget. Lenient on ": " in plain values; unrecognized structure returns
// null so the block renders as ordinary markdown.
function parseMapping(text: string): [string, string][] | null {
  const lines = text.split(/\r?\n/);
  const entries: [string, string][] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      i++;
      continue;
    }
    if (/^[ \t]/.test(line)) return null;
    const m = KEY_RE.exec(line);
    if (!m) return null;
    const key = m[1];
    const rest = (m[2] ?? "").trim();
    i++;
    if (rest === "" || /^[>|][+-]?$/.test(rest)) {
      const block: string[] = [];
      while (
        i < lines.length &&
        (lines[i].trim() === "" || /^[ \t]/.test(lines[i]))
      ) {
        block.push(lines[i]);
        i++;
      }
      const dedented = dedent(block);
      entries.push([
        key,
        rest.startsWith(">") ? dedented.replace(/\n+/g, " ").trim() : dedented,
      ]);
    } else {
      entries.push([key, unquote(rest)]);
    }
  }
  return entries;
}

function dedent(lines: string[]): string {
  const nonBlank = lines.filter((l) => l.trim() !== "");
  if (nonBlank.length === 0) return "";
  const indent = Math.min(
    ...nonBlank.map((l) => (/^[ \t]*/.exec(l) as RegExpExecArray)[0].length),
  );
  return lines
    .map((l) => l.slice(indent))
    .join("\n")
    .trim();
}

function unquote(value: string): string {
  const q = value[0];
  if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) {
    return value.slice(1, -1);
  }
  return value;
}
