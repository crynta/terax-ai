/**
 * The file a fenced code block in a Claude reply belongs to, when it says so:
 * an info string like `ts title=src/a.ts` or `src/a.ts`, or a first-line
 * comment naming the path (`// src/a.ts`, `# app/main.py`, `<!-- a.html -->`).
 */

/** A relative or absolute path with a file extension, no spaces or URL scheme. */
const PATH_LIKE =
  /^(?:~\/|\.{1,2}\/|\/)?(?:[\w.@+-]+\/)*[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,10}$/;

function asPath(candidate: string | undefined): string | null {
  if (!candidate) return null;
  const value = candidate.trim().replace(/^["'`]|["'`]$/g, "");
  if (!value || value.includes("://") || !PATH_LIKE.test(value)) return null;
  // A bare "a.ts" is ambiguous with a language tag only when there's no dot.
  return value;
}

const COMMENT_PATTERNS = [
  /^\s*(?:\/\/|#|--|;)\s*(?:file(?:name)?:\s*)?(\S+)\s*$/i,
  /^\s*\/\*\s*(?:file(?:name)?:\s*)?(\S+)\s*\*\/\s*$/i,
  /^\s*<!--\s*(?:file(?:name)?:\s*)?(\S+)\s*-->\s*$/i,
];

/** The path a code block names, or null. `info` is the fence's info string after the language. */
export function codeBlockPath(
  code: string,
  lang: string | null,
  info: string | null = null,
): string | null {
  const fromInfo = info
    ?.split(/\s+/)
    .map((part) => part.replace(/^(?:title|file|filename|path)=/, ""))
    .map(asPath)
    .find(Boolean);
  if (fromInfo) return fromInfo;
  if (lang && (lang.includes("/") || lang.includes("."))) {
    const fromLang = asPath(lang.split(":").pop());
    if (fromLang) return fromLang;
  }
  const first = code.split("\n", 1)[0] ?? "";
  for (const pattern of COMMENT_PATTERNS) {
    const match = first.match(pattern);
    const path = asPath(match?.[1]);
    if (path?.includes("/")) return path;
  }
  return null;
}

/** `path` resolved against the session folder when relative. */
export function resolveBlockPath(
  path: string,
  cwd: string | null,
  home: string | null,
): string {
  if (path.startsWith("~/") && home) return `${home}/${path.slice(2)}`;
  if (path.startsWith("/") || !cwd) return path;
  return `${cwd.replace(/\/+$/, "")}/${path.replace(/^\.\//, "")}`;
}
