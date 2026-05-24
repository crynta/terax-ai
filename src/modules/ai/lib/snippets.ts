import { LazyStore } from "@tauri-apps/plugin-store";

export type Snippet = {
  id: string;
  /** The "#handle" used in the composer. Lowercase, [a-z0-9-]+. */
  handle: string;
  name: string;
  description: string;
  content: string;
};

const STORE_PATH = "termax-ai-snippets.json";
const KEY_LIST = "snippets";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export async function loadSnippets(): Promise<Snippet[]> {
  return (await store.get<Snippet[]>(KEY_LIST)) ?? [];
}

export async function saveSnippets(list: Snippet[]): Promise<void> {
  await store.set(KEY_LIST, list);
  await store.save();
}

export function newSnippetId(): string {
  return `sn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const HANDLE_RE = /^[a-z0-9][a-z0-9-]*$/;

export function normalizeHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isValidHandle(h: string): boolean {
  return HANDLE_RE.test(h);
}

/**
 * Replace `#handle` tokens in `text` with their snippet bodies, wrapped in
 * `<snippet name="…">…</snippet>` blocks, prepended to the message. Tokens that
 * don't match a known snippet are left as-is.
 *
 * Returns the rewritten body (with tokens stripped) and the list of expanded
 * snippet blocks to prepend.
 */
export function expandSnippetTokens(
  text: string,
  snippets: readonly Snippet[],
): { body: string; blocks: string[] } {
  const byHandle = new Map(snippets.map((s) => [s.handle, s]));
  const matched = new Map<string, Snippet>();
  // (^|\s)#handle  — handle is [a-z0-9][a-z0-9-]*
  const re = /(^|\s)#([a-z0-9][a-z0-9-]*)\b/gi;
  const body = text.replace(re, (full, lead: string, raw: string) => {
    const h = raw.toLowerCase();
    const snip = byHandle.get(h);
    if (!snip) return full;
    matched.set(snip.id, snip);
    return lead;
  });
  const blocks = Array.from(matched.values()).map(
    (s) => `<snippet name="${s.handle}">\n${s.content}\n</snippet>`,
  );
  return { body: body.replace(/[ \t]+\n/g, "\n").trim(), blocks };
}
