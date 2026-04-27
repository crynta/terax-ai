import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Cancel01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ToolUIPart } from "ai";

type Props = {
  part: Extract<ToolUIPart, { state: "approval-requested" }>;
  toolName: string;
  onRespond: (approved: boolean) => void;
};

const TOOL_LABELS: Record<string, string> = {
  write_file: "Write file",
  create_directory: "Create directory",
  run_command: "Run shell command",
};

export function AiToolApproval({ part, toolName, onRespond }: Props) {
  const label = TOOL_LABELS[toolName] ?? toolName;
  const input = part.input as Record<string, unknown>;

  return (
    <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-yellow-700 dark:text-yellow-400">
          {label} — needs approval
        </span>
      </div>
      <PreviewBlock toolName={toolName} input={input} />
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={() => onRespond(true)}
          className="h-7 gap-1.5"
        >
          <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
          Approve
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRespond(false)}
          className="h-7 gap-1.5"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
          Deny
        </Button>
      </div>
    </div>
  );
}

function PreviewBlock({
  toolName,
  input,
}: {
  toolName: string;
  input: Record<string, unknown>;
}) {
  if (toolName === "run_command") {
    const cwd = typeof input.cwd === "string" ? input.cwd : null;
    return (
      <div className="space-y-1.5">
        {cwd && (
          <div className="text-[11px] text-muted-foreground">in {cwd}</div>
        )}
        <pre
          className={cn(
            "max-h-40 overflow-auto rounded bg-muted/60 p-2 font-mono text-xs",
          )}
        >
          {String(input.command ?? "")}
        </pre>
      </div>
    );
  }
  if (toolName === "write_file") {
    const content = typeof input.content === "string" ? input.content : "";
    const preview = content.length > 600
      ? `${content.slice(0, 600)}\n…(${content.length - 600} more chars)`
      : content;
    return (
      <div className="space-y-1.5">
        <div className="font-mono text-[11px] text-muted-foreground">
          {String(input.path ?? "")}
        </div>
        <pre className="max-h-40 overflow-auto rounded bg-muted/60 p-2 font-mono text-xs">
          {preview}
        </pre>
      </div>
    );
  }
  if (toolName === "create_directory") {
    return (
      <div className="font-mono text-xs text-muted-foreground">
        {String(input.path ?? "")}
      </div>
    );
  }
  return (
    <pre className="overflow-auto rounded bg-muted/60 p-2 font-mono text-xs">
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}
