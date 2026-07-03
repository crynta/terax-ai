import { useDiagnosticsStore } from "@/modules/editor";
import { Alert02Icon, CancelCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type Props = {
  filePath: string | null;
};

export function DiagnosticsBadge({ filePath }: Props) {
  const counts = useDiagnosticsStore((s) =>
    filePath ? s.byPath[filePath] : undefined,
  );
  if (!counts || (counts.errors === 0 && counts.warnings === 0)) return null;

  return (
    <span className="terax-pill-in flex shrink-0 cursor-default items-center gap-2 text-[10.5px] font-medium tabular-nums">
      {counts.errors > 0 ? (
        <span className="flex items-center gap-0.5 text-destructive">
          <HugeiconsIcon icon={CancelCircleIcon} size={11} strokeWidth={2} />
          {counts.errors}
        </span>
      ) : null}
      {counts.warnings > 0 ? (
        <span className="flex items-center gap-0.5 text-amber-700 dark:text-amber-400">
          <HugeiconsIcon icon={Alert02Icon} size={11} strokeWidth={2} />
          {counts.warnings}
        </span>
      ) : null}
    </span>
  );
}
