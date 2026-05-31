import { quoteShellArg } from "@/lib/shellQuote";

export function formatDroppedPaths(
  paths: readonly string[],
  windows?: boolean,
): string {
  const quoted = paths
    .filter((path) => path.length > 0)
    .map((path) => quoteShellArg(path, windows));

  return quoted.length > 0 ? `${quoted.join(" ")} ` : "";
}

export function parsePaneLeafId(raw: string | undefined): number | null {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) ? value : null;
}
