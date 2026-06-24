import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

interface Props {
  children: React.ReactNode;
  repoRoot: string | null;
  suggestedName: string;
  onCreate: (branchName: string) => Promise<string>;
  busy: boolean;
  error: string | null;
  onClearError?: () => void;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/** When creating a worktree from a worktree, extract the project name.
 *  e.g. if inside ~/.terax/worktrees/{project}/{branch}, extract {project}.
 *  otherwise use the repo root basename. */
function projectNameFromRepoRoot(repoRoot: string): string {
  const normalized = repoRoot.replace(/\\/g, "/");
  const id = normalized.indexOf(".terax/worktrees/");
  if (id !== -1) {
    const after = normalized.slice(id + ".terax/worktrees/".length);
    const slash = after.indexOf("/");
    return slash !== -1 ? after.slice(0, slash) : after;
  }
  return basename(normalized);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function NewWorktreePopover({
  children,
  repoRoot,
  suggestedName,
  onCreate,
  busy,
  error,
  onClearError,
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    onClearError?.();
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, [open, onClearError]);

  const resolvedName = slugify(name) || suggestedName;
  const projectName = repoRoot ? projectNameFromRepoRoot(repoRoot) : "project";
  const previewPath = `~/.terax/worktrees/${projectName}/${resolvedName || "…"}/`;

  const submit = async () => {
    const branchName = slugify(name) || suggestedName;
    if (!branchName) return;
    const worktreePath = await onCreate(branchName);
    if (!worktreePath) return;
    setOpen(false);
    setName("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-50 p-3"
      >
        <PopoverHeader className="gap-0">
          <PopoverTitle className="flex items-center gap-1.5 text-sm font-semibold">
            <HugeiconsIcon icon={GitBranchIcon} size={14} strokeWidth={1.75} />
            New worktree
          </PopoverTitle>
        </PopoverHeader>

        <div className="flex flex-col gap-2">
          <Input
            ref={inputRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              onClearError?.();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={suggestedName || "branch-name"}
            disabled={busy}
            className="h-8 text-xs"
          />
          {error ? (
            <div className="wrap-break-word text-[10.5px] leading-tight text-destructive">
              {error}
            </div>
          ) : (
            <div className="text-[10px] leading-tight text-muted-foreground truncate">
              {previewPath}
            </div>
          )}
          <div className="flex items-center justify-end gap-1.5 pt-0.5">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="h-7 text-[11px]"
            >
              Cancel
            </Button>
            <Button
              size="xs"
              onClick={() => void submit()}
              disabled={busy || !resolvedName}
              className="h-7 text-[11px]"
            >
              {busy ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
