export const WINDOW_HTML: string[];
export const FORBIDDEN_CHUNK_PATTERNS: RegExp[];
export const FORBIDDEN_SIGNATURES: { label: string; needle: string }[];
export const FORBIDDEN_PACKAGES: RegExp[];

export function staticImports(code: string): string[];
export function parseHtmlAssets(html: string): {
  scripts: string[];
  preloads: string[];
  styles: string[];
};
export function chunkName(file: string): string;
export function packagesFromMap(mapText: string | null): Set<string> | null;

export type StartupFile = {
  bytes: number;
  via: string | null;
  code: string;
  packages: Set<string> | null;
};
export type StartupTrace = {
  files: Map<string, StartupFile>;
  styles: string[];
  missing: string[];
};
export type Violation = { file: string; reason: string; via: string | null };

export function traceStartup(
  html: string,
  readChunk: (distRelativePath: string) => string | null,
): StartupTrace;
export function findViolations(trace: StartupTrace): Violation[];
export function startupBytes(trace: StartupTrace): number;
export function analyzeDist(
  distDir: string,
  windows?: string[],
): Record<
  string,
  { trace: StartupTrace; violations: Violation[]; bytes: number }
>;
