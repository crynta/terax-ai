import { IS_WINDOWS } from "@/lib/platform";
import { quoteShellArg } from "@/lib/shellQuote";

export function quoteShellPath(path: string, windows = IS_WINDOWS): string {
  return quoteShellArg(path, windows, true);
}

export function formatDroppedPaths(
  paths: string[],
  windows = IS_WINDOWS,
): string {
  return `${paths.map((path) => quoteShellPath(path, windows)).join(" ")} `;
}
