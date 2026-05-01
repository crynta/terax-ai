import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Cancel01Icon,
  Edit02Icon,
  FileEditIcon,
  FilePlusIcon,
  FolderAddIcon,
  TerminalIcon,
  Tick02Icon,
  ToolsIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ToolUIPart } from "ai";

type Props = {
  part: Extract<ToolUIPart, { state: "approval-requested" }>;
  toolName: string;
  onRespond: (approved: boolean) => void;
};

const TOOL_META: Record<string, { label: string; icon: typeof FilePlusIcon }> =
  {
    write_file: { label: "Write file", icon: FilePlusIcon },
    edit: { label: "Edit file", icon: FileEditIcon },
    multi_edit: { label: "Edit file (batch)", icon: Edit02Icon },
    create_directory: { label: "Create directory", icon: FolderAddIcon },
    bash_run: { label: "Run shell command", icon: TerminalIcon },
    bash_background: { label: "Spawn background process", icon: TerminalIcon },
  };

export function AiToolApproval({ part, toolName, onRespond }: Props) {
  const meta = TOOL_META[toolName];
  const label = meta?.label ?? toolName;
  const Icon = meta?.icon ?? ToolsIcon;
  const input = part.input as Record<string, unknown>;

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className="size-1.5 shrink-0 rounded-full bg-amber-500 animate-pulse" />
        <HugeiconsIcon
          icon={Icon}
          size={13}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <span className="text-[12px] font-medium text-foreground">
          {label}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          needs approval
        </span>
      </div>

      <div className="px-3 py-2.5">
        <PreviewBlock toolName={toolName} input={input} />
      </div>

      <div className="flex items-center justify-end gap-1.5 border-t border-border/60 px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRespond(false)}
          className="h-7 gap-1.5 text-[11px]"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
          Deny
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={() => onRespond(true)}
          className="h-7 gap-1.5 text-[11px]"
        >
          <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2} />
          Approve
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
  if (toolName === "bash_run" || toolName === "bash_background") {
    const cwd = typeof input.cwd === "string" ? input.cwd : null;
    return (
      <div className="space-y-1.5">
        {cwd && (
          <div className="font-mono text-[10.5px] text-muted-foreground">
            {cwd}
          </div>
        )}
        <pre
          className={cn(
            "max-h-40 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed",
          )}
        >
          {String(input.command ?? "")}
        </pre>
      </div>
    );
  }
  if (toolName === "write_file") {
    const content = typeof input.content === "string" ? input.content : "";
    const preview =
      content.length > 600
        ? `${content.slice(0, 600)}\n…(${content.length - 600} more chars)`
        : content;
    return (
      <div className="space-y-1.5">
        <div className="font-mono text-[10.5px] text-muted-foreground">
          {String(input.path ?? "")}
        </div>
        <pre className="max-h-40 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed">
          {preview}
        </pre>
      </div>
    );
  }
  if (toolName === "edit") {
    const oldStr = typeof input.old_string === "string" ? input.old_string : "";
    const newStr = typeof input.new_string === "string" ? input.new_string : "";
    return (
      <div className="space-y-1.5">
        <div className="font-mono text-[10.5px] text-muted-foreground">
          {String(input.path ?? "")}
          {input.replace_all ? " · replace all" : ""}
        </div>
        <UnifiedDiff oldStr={oldStr} newStr={newStr} />
      </div>
    );
  }
  if (toolName === "multi_edit") {
    const edits = Array.isArray(input.edits)
      ? (input.edits as Array<{ old_string?: string; new_string?: string }>)
      : [];
    return (
      <div className="space-y-1.5">
        <div className="font-mono text-[10.5px] text-muted-foreground">
          {String(input.path ?? "")} · {edits.length} edit
          {edits.length === 1 ? "" : "s"}
        </div>
        <div className="space-y-1.5">
          {edits.slice(0, 3).map((e, idx) => (
            <UnifiedDiff
              key={idx}
              oldStr={e.old_string ?? ""}
              newStr={e.new_string ?? ""}
            />
          ))}
          {edits.length > 3 ? (
            <div className="text-[10px] italic text-muted-foreground">
              + {edits.length - 3} more
            </div>
          ) : null}
        </div>
      </div>
    );
  }
  if (toolName === "create_directory") {
    return (
      <div className="font-mono text-[11px] text-muted-foreground">
        {String(input.path ?? "")}
      </div>
    );
  }
  return (
    <pre className="overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed">
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}

function UnifiedDiff({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const removed = oldStr.split("\n");
  const added = newStr.split("\n");
  // Strip a trailing empty line caused by terminal "\n"
  if (removed.length > 1 && removed[removed.length - 1] === "") removed.pop();
  if (added.length > 1 && added[added.length - 1] === "") added.pop();

  const MAX = 40;
  const removedShown = removed.slice(0, MAX);
  const addedShown = added.slice(0, MAX);
  const removedRest = removed.length - removedShown.length;
  const addedRest = added.length - addedShown.length;

  return (
    <div className="overflow-hidden rounded-md border border-border/50 bg-muted/20 font-mono text-[11px] leading-relaxed">
      <div className="max-h-64 overflow-auto">
        {removedShown.map((line, i) => (
          <DiffLine key={`r-${i}`} kind="del" line={line} />
        ))}
        {removedRest > 0 ? (
          <DiffLine kind="meta" line={`… ${removedRest} more removed`} />
        ) : null}
        {addedShown.map((line, i) => (
          <DiffLine key={`a-${i}`} kind="add" line={line} />
        ))}
        {addedRest > 0 ? (
          <DiffLine kind="meta" line={`… ${addedRest} more added`} />
        ) : null}
      </div>
    </div>
  );
}

function DiffLine({
  kind,
  line,
}: {
  kind: "add" | "del" | "meta";
  line: string;
}) {
  const sigil = kind === "add" ? "+" : kind === "del" ? "-" : " ";
  const cls =
    kind === "add"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : kind === "del"
        ? "bg-destructive/10 text-destructive"
        : "text-muted-foreground italic";
  return (
    <div className={cn("flex whitespace-pre", cls)}>
      <span className="w-4 shrink-0 select-none px-1 text-center opacity-70">
        {sigil}
      </span>
      <span className="min-w-0 flex-1 overflow-x-auto pr-2">{line || " "}</span>
    </div>
  );
}
