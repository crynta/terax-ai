import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  MinusSignIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState, type ReactNode } from "react";
import { useSourceControl, type SourceControlEntry } from "./useSourceControl";

type Props = {
  open: boolean;
  contextPath: string | null;
  onClose: () => void;
  onOpenDiff: (input: {
    path: string;
    repoRoot: string;
    mode: "+" | "-";
    originalContent: string;
    modifiedContent: string;
    isBinary: boolean;
    fallbackPatch: string;
  }) => void;
};

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

export function SourceControlPanel({
  open,
  contextPath,
  onClose,
  onOpenDiff,
}: Props) {
  const scm = useSourceControl(open, contextPath, onOpenDiff);

  const canCommit =
    scm.stagedEntries.length > 0 &&
    scm.commitMessage.trim().length > 0 &&
    scm.actionBusy !== "commit";

  const subtitle = useMemo(() => {
    if (!scm.status) return null;
    const parts = [scm.status.branch];
    if (scm.status.upstream) parts.push(scm.status.upstream);
    if (scm.status.ahead > 0 || scm.status.behind > 0) {
      parts.push(`↑${scm.status.ahead} ↓${scm.status.behind}`);
    }
    return parts.join(" · ");
  }, [scm.status]);

  if (!open) return null;

  return (
    <aside className="flex h-full min-w-0 flex-col border-l border-border/60 bg-card/80 backdrop-blur">
      <div className="flex h-11 items-center justify-between border-b border-border/60 px-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
            Source Control
            {scm.diffLoading ? <Spinner className="size-3.5" /> : null}
          </div>
          <div className="truncate text-[10.5px] text-muted-foreground">
            {subtitle ?? "Git workspace"}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => void scm.refresh()}
            disabled={scm.panelState === "loading" || !!scm.actionBusy}
          >
            Refresh
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>

      {scm.panelState === "loading" ? (
        <PanelCenter title="Loading repository" />
      ) : null}

      {scm.panelState === "no-repo" ? (
        <PanelCenter
          title="No repository"
          body="The active workspace is not inside a Git repository."
        />
      ) : null}

      {scm.panelState === "error" ? (
        <PanelCenter
          title="Source control error"
          body={scm.error ?? "Unknown source control error"}
          action={
            <Button size="sm" onClick={() => void scm.refresh()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {scm.panelState === "ready" && scm.status ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {scm.error ? (
            <div className="px-3 pb-2 text-[11px] text-destructive">
              {scm.error}
            </div>
          ) : null}
          {scm.actionMessage ? (
            <div className="px-3 pb-2 text-[11px] text-emerald-600 dark:text-emerald-400">
              {scm.actionMessage}
            </div>
          ) : null}

          <ScrollArea className="min-h-0 flex-1 border-none">
            <div className="space-y-3 p-3 pt-0">
              <ChangeGroup
                title="Staged"
                entries={scm.stagedEntries}
                selected={scm.selected}
                actionBusy={scm.actionBusy}
                empty="No staged files"
                defaultOpen
                actionType="unstage"
                onActionAll={scm.unstageAllEntries}
                onSelect={scm.selectEntry}
                onAction={scm.unstageEntry}
              />
              <ChangeGroup
                title="Changes"
                entries={scm.unstagedEntries}
                selected={scm.selected}
                actionBusy={scm.actionBusy}
                empty="Working tree is clean"
                defaultOpen
                actionType="stage"
                onActionAll={scm.stageAllEntries}
                onSelect={scm.selectEntry}
                onAction={scm.stageEntry}
              />
            </div>
          </ScrollArea>

          <Separator />

          <div className="space-y-2 p-3">
            <Textarea
              value={scm.commitMessage}
              onChange={(event) => scm.setCommitMessage(event.target.value)}
              placeholder="Commit message"
              className="min-h-24 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="flex-1"
                disabled={!canCommit || !!scm.actionBusy}
                onClick={() => void scm.commit()}
              >
                {scm.actionBusy === "commit" ? "Committing..." : "Commit"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                disabled={!!scm.actionBusy}
                onClick={() => void scm.push()}
              >
                {scm.actionBusy === "push" ? "Pushing..." : "Push"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function PanelCenter({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="text-sm font-medium">{title}</div>
      {body ? (
        <div className="max-w-64 text-[11px] leading-relaxed text-muted-foreground">
          {body}
        </div>
      ) : null}
      {action}
    </div>
  );
}

function ChangeGroup({
  title,
  entries,
  selected,
  actionBusy,
  empty,
  defaultOpen,
  actionType,
  onActionAll,
  onSelect,
  onAction,
}: {
  title: string;
  entries: SourceControlEntry[];
  selected: { path: string; mode: "-" | "+" } | null;
  actionBusy: string | null;
  empty: string;
  defaultOpen?: boolean;
  actionType: "stage" | "unstage";
  onActionAll: () => Promise<void>;
  onSelect: (entry: SourceControlEntry) => Promise<void>;
  onAction: (entry: SourceControlEntry) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? false);
  const actionIcon = actionType === "stage" ? PlusSignIcon : MinusSignIcon;
  const isHeaderActionBusy = actionBusy === `${actionType}:all`;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between border-b border-border/60 px-3 py-2 text-left"
          >
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                icon={isOpen ? ArrowDown01Icon : ArrowRight01Icon}
                size={12}
                strokeWidth={2}
                className="text-muted-foreground"
              />
              <div className="text-[11px] font-medium">{title}</div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 px-0"
                disabled={actionBusy !== null || entries.length === 0}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void onActionAll();
                }}
              >
                {isHeaderActionBusy ? (
                  "..."
                ) : (
                  <HugeiconsIcon icon={actionIcon} size={11} strokeWidth={2} />
                )}
              </Button>
              <Badge variant="outline" className="text-[10px]">
                {entries.length}
              </Badge>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {entries.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">
              {empty}
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {entries.map((entry) => {
                const isSelected =
                  selected?.path === entry.path && selected.mode === entry.mode;
                return (
                  <li
                    key={entry.key}
                    className="flex items-center gap-2 px-2 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => void onSelect(entry)}
                      className={cn(
                        "min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left transition-colors",
                        isSelected
                          ? "bg-accent text-foreground"
                          : "hover:bg-accent/60",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[11px] font-medium">
                          {basename(entry.path)}
                        </span>
                        <Badge variant="secondary" className="text-[9px]">
                          {entry.statusLabel}
                        </Badge>
                        {isSelected ? (
                          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                            Open
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {entry.originalPath
                          ? `${entry.originalPath} → ${entry.path}`
                          : entry.path}
                      </div>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[10.5px]"
                      disabled={actionBusy !== null}
                      onClick={() => void onAction(entry)}
                    >
                      {actionBusy === `${actionType}:${entry.path}` ? (
                        "..."
                      ) : (
                        <HugeiconsIcon
                          icon={actionIcon}
                          size={12}
                          strokeWidth={2}
                        />
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
