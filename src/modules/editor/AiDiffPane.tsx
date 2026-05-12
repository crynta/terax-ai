import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { AiDiffStatus } from "@/modules/tabs";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo } from "react";

type Props = {
  path: string;
  originalContent: string;
  proposedContent: string;
  status: AiDiffStatus;
  isNewFile: boolean;
  onAccept: () => void;
  onReject: () => void;
};

const STATUS_LABEL: Record<AiDiffStatus, string> = {
  pending: "Pending review",
  approved: "Applied",
  rejected: "Rejected",
};

const STATUS_BADGE: Record<
  AiDiffStatus,
  "outline" | "secondary" | "destructive"
> = {
  pending: "outline",
  approved: "secondary",
  rejected: "destructive",
};

/**
 * Renders an AI-proposed edit as a side-by-side diff using `@pierre/diffs`.
 *
 * The previous implementation used CodeMirror's unified merge view; we
 * swapped to Pierre because its split layout, character-level inline
 * highlights, and per-line annotation primitives line up better with the
 * agentic review flow (and especially with the per-tool-call permission
 * round-trip that ACP backends use).
 */
export function AiDiffPane({
  path,
  originalContent,
  proposedContent,
  status,
  isNewFile,
  onAccept,
  onReject,
}: Props) {
  const editorThemeId = usePreferencesStore((s) => s.editorTheme);

  // Pierre takes plain before/after strings and computes the patch
  // internally via jsdiff. The result is memoized off the inputs since the
  // surrounding bridge re-creates the tab when the AI updates its proposal.
  const fileDiff: FileDiffMetadata = useMemo(
    () =>
      parseDiffFromFile(
        { name: path, contents: isNewFile ? "" : originalContent },
        { name: path, contents: proposedContent },
      ),
    [path, originalContent, proposedContent, isNewFile],
  );

  const stats = useMemo(() => computeLineStats(fileDiff), [fileDiff]);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border border-border/60 bg-background">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            className="text-[11px] px-2.5 py-2.5"
            variant={STATUS_BADGE[status]}
          >
            {STATUS_LABEL[status]}
          </Badge>
          {isNewFile ? (
            <span className="shrink-0 rounded-full border border-border/60 bg-accent/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              New file
            </span>
          ) : null}
          <span
            className="truncate font-mono text-[11px] text-muted-foreground"
            title={path}
          >
            {path}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{stats.added}
            </span>
            <span className="text-rose-600 dark:text-rose-400">
              −{stats.removed}
            </span>
          </span>
        </div>
        {status === "pending" ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="default"
              onClick={onAccept}
              className="h-7 gap-1.5"
            >
              <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2} />
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onReject}
              className="h-7 gap-1.5"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
              Reject
            </Button>
          </div>
        ) : null}
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto"
        data-terax-editor-theme={editorThemeId}
      >
        <FileDiff
          fileDiff={fileDiff}
          options={{
            diffStyle: "split",
            diffIndicators: "classic",
            lineDiffType: "word",
          }}
          className="h-full"
        />
      </div>
    </div>
  );
}

/**
 * Sum +/− line counts across the parsed hunks. Pierre's `Hunk` exposes
 * the addition/deletion counts directly as `additionLines` /
 * `deletionLines` (counts of `+`/`−` lines, distinct from the array fields
 * on `FileDiffMetadata` that hold the actual line text).
 */
function computeLineStats(
  fileDiff: FileDiffMetadata,
): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of fileDiff.hunks) {
    added += h.additionLines;
    removed += h.deletionLines;
  }
  return { added, removed };
}
