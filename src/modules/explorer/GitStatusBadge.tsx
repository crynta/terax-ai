import { cn } from "@/lib/utils";
import type { GitStatusCode } from "./lib/gitStatusUtils";

type Props = {
  code: GitStatusCode;
  isDir?: boolean;
};

const TEXT_CLASS: Record<GitStatusCode, string> = {
  M: "text-amber-600 dark:text-amber-400",
  A: "text-emerald-600 dark:text-emerald-400",
  D: "text-rose-600 dark:text-rose-400",
  U: "text-green-600 dark:text-green-400",
};

const FOLDER_DOT_CLASS = "bg-amber-500/30";

export function GitStatusBadge({ code, isDir = false }: Props) {
  if (isDir) {
    return (
      <span
        className={cn("ml-auto size-2 shrink-0 rounded-full", FOLDER_DOT_CLASS)}
        aria-hidden
      />
    );
  }

  return (
    <span
      className={cn(
        "ml-auto shrink-0 text-[10px] font-semibold tabular-nums",
        TEXT_CLASS[code],
      )}
      aria-hidden
    >
      {code}
    </span>
  );
}
