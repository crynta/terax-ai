import { cn } from "@/lib/utils";
import {
  gitFolderDirtyDotClass,
  gitStatusTextClass,
} from "@/modules/source-control/gitStatusPalette";
import type { GitStatusCode } from "./lib/gitStatusUtils";

type Props = {
  code: GitStatusCode;
  isDir?: boolean;
};

export function GitStatusBadge({ code, isDir = false }: Props) {
  if (isDir) {
    return (
      <span
        className={cn(
          "ml-auto size-2 shrink-0 rounded-full",
          gitFolderDirtyDotClass,
        )}
        aria-hidden
      />
    );
  }

  return (
    <span
      className={cn(
        "ml-auto shrink-0 text-[10px] font-semibold tabular-nums leading-none",
        gitStatusTextClass(code),
      )}
      aria-hidden
    >
      {code}
    </span>
  );
}
