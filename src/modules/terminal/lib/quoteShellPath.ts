import { IS_WINDOWS } from "@/lib/platform";
import { quotePathArg, type ShellDialect } from "@/lib/shellQuote";

export function quoteShellPath(
  path: string,
  windows: boolean | ShellDialect = IS_WINDOWS,
): string {
  return quotePathArg(
    path,
    typeof windows === "boolean" ? (windows ? "powershell" : "posix") : windows,
  );
}

export function formatDroppedPaths(
  paths: string[],
  windows: boolean | ShellDialect = IS_WINDOWS,
): string {
  return `${paths.map((path) => quoteShellPath(path, windows)).join(" ")} `;
}
