import type { Extension } from "@codemirror/state";
import { extensionMap, filenameMap } from "./languageDefinitions";

export interface LanguageResult {
  ext: Extension;
  name: string;
}
const cache = new Map<string, LanguageResult | null>();

function extOf(name: string): string | null {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1 || dot === lower.length - 1) return null;
  return lower.slice(dot + 1);
}

function prefixOf(base: string): string | null {
  const dot = base.indexOf(".");
  return dot > 0 ? base.slice(0, dot) : null;
}

function isStreamParser(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { token?: unknown }).token === "function"
  );
}

function cacheKey(filename: string): string | null {
  const lower = filename.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  const ext = extOf(base) ?? prefixOf(base);
  return ext ? `ext:${ext}` : null;
}

export function resolveDisplayName(extOrFilename: string | null): string {
  if (!extOrFilename) return "Plain Text";
  const lower = extOrFilename.toLowerCase();
  const base = lower.split(/[\\/]/).pop() ?? lower;

  const def = filenameMap.get(base) ?? extensionMap.get(extOf(base) ?? base);
  if (def) return def.name;

  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function resolveLanguageSync(filename: string): LanguageResult | null {
  const key = cacheKey(filename);
  return key ? (cache.get(key) ?? null) : null;
}

export async function resolveLanguage(
  filename: string,
): Promise<LanguageResult | null> {
  const key = cacheKey(filename);
  if (!key) return null;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const lower = filename.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  const extension = extOf(base) ?? prefixOf(base) ?? "";

  const def = filenameMap.get(base) ?? extensionMap.get(extension);
  if (!def) {
    cache.set(key, null);
    return null;
  }

  const raw = await def.loader();
  const ext = isStreamParser(raw)
    ? (raw as { token: Extension }).token
    : (raw as Extension);
  const result = { ext, name: def.name } as LanguageResult;
  cache.set(key, result);
  return result;
}

export function preloadLanguages(filenames: string[]): void {
  for (const f of filenames) {
    void resolveLanguage(f).catch(() => {});
  }
}
