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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { IS_MAC } from "@/lib/platform";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  Delete01Icon,
  GitBranchIcon,
  MinusSignIcon,
  PlusSignIcon,
  Refresh01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { SourceControlSummary } from "./useSourceControl";
import {
  useSourceControlPanel,
  type SourceControlEntry,
} from "./useSourceControlPanel";

type Props = {
  open: boolean;
  sourceControl: SourceControlSummary;
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

const SOURCE_CONTROL_TOOLTIP_CLASS =
  "border border-border/70 bg-zinc-950 text-zinc-100 shadow-lg shadow-black/30 dark:border-border/60 dark:bg-zinc-950 dark:text-zinc-100";

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  return normalized.slice(0, index);
}

function entryPathLabel(entry: SourceControlEntry): string {
  if (entry.originalPath) {
    return `${entry.originalPath} → ${entry.path}`;
  }
  return dirname(entry.path);
}

function upstreamBadgeLabel(upstream: string | null | undefined): string {
  if (!upstream) return "No upstream";
  const [remote] = upstream.split("/");
  return remote || upstream;
}

function statusTone(statusCode: string): string {
  switch (statusCode) {
    case "A":
    case "?":
      return "text-emerald-700 dark:text-emerald-400";
    case "M":
      return "text-amber-700 dark:text-amber-300";
    case "D":
      return "text-rose-700 dark:text-rose-400";
    case "R":
      return "text-sky-700 dark:text-sky-300";
    default:
      return "text-muted-foreground";
  }
}

export const SourceControlPanel = memo(function SourceControlPanel({
  open,
  sourceControl,
  onClose,
  onOpenDiff,
}: Props) {
  const rootRef = useRef<HTMLElement | null>(null);
  const refreshAnimationRef = useRef<number | null>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const [refreshAnimating, setRefreshAnimating] = useState(false);
  const scm = useSourceControlPanel(open, sourceControl, onOpenDiff, panelWidth);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      setPanelWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (refreshAnimationRef.current) {
        window.clearTimeout(refreshAnimationRef.current);
      }
    };
  }, []);

  const isRefreshing = scm.panelState === "loading" || scm.diffLoading;
  const repoLabel = useMemo(() => {
    if (!scm.status) return "Source Control";
    return scm.status.isDetached ? "detached" : scm.status.branch;
  }, [scm.status]);

  const headerMeta = useMemo(() => {
    if (!scm.status) return null;
    const parts: string[] = [];
    if (scm.status.ahead > 0 || scm.status.behind > 0) {
      parts.push(`↑${scm.status.ahead} ↓${scm.status.behind}`);
    }
    if (scm.status.isDetached) {
      parts.push("Detached HEAD");
    }
    return parts.join(" · ");
  }, [scm.status]);

  const commitShortcut = IS_MAC ? "⌘+Enter" : "Ctrl+Enter";
  const canCommit =
    scm.stagedEntries.length > 0 &&
    scm.commitMessage.trim().length > 0 &&
    !scm.actionBusy;
  const commitDisabledReason = scm.actionBusy
    ? "Wait for the current Git action to finish."
    : scm.stagedEntries.length === 0
      ? "Stage changes to enable commit."
      : scm.commitMessage.trim().length === 0
        ? "Enter a commit message to enable commit."
        : null;
  const commitHint = canCommit
    ? `Commit with ${commitShortcut}.`
    : (commitDisabledReason ?? `Commit with ${commitShortcut}.`);
  const pushHint = scm.pushHint ?? "Push is unavailable right now.";
  const pushDisabledReason = scm.actionBusy
    ? "Wait for the current Git action to finish."
    : pushHint;
  const stagedCount = scm.stagedEntries.length;
  const stagedCountLabel = `${stagedCount} staged`;
  const commitStatusLabel = scm.actionBusy
    ? "Git action in progress"
    : stagedCount === 0
      ? "Stage files first"
      : scm.commitMessage.trim().length === 0
        ? "Message required"
        : `Ready: ${stagedCount} ${stagedCount === 1 ? "file" : "files"}`;
  const pushStatusLabel = upstreamBadgeLabel(scm.status?.upstream);
  const footerFeedback = useMemo(() => {
    if (scm.actionError) {
      return { tone: "error", message: scm.actionError } as const;
    }
    if (scm.remoteError) {
      return { tone: "error", message: scm.remoteError } as const;
    }
    if (scm.actionMessage) {
      return { tone: "success", message: scm.actionMessage } as const;
    }
    return null;
  }, [scm.actionError, scm.actionMessage, scm.remoteError]);

  const handleCommitShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    if (!canCommit) return;
    event.preventDefault();
    void scm.commit();
  };

  const handleRefresh = () => {
    setRefreshAnimating(true);
    if (refreshAnimationRef.current) {
      window.clearTimeout(refreshAnimationRef.current);
    }
    void scm.refresh().finally(() => {
      refreshAnimationRef.current = window.setTimeout(() => {
        setRefreshAnimating(false);
        refreshAnimationRef.current = null;
      }, 450);
    });
  };

  if (!open) return null;

  return (
    <TooltipProvider delayDuration={800} skipDelayDuration={300}>
      <aside
        ref={rootRef}
        className="flex h-full min-w-0 flex-col border-l border-border/60 bg-card"
      >
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b border-border/60",
          scm.compact ? "px-2.5 py-1.5" : "px-3 py-2",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[8.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Source Control
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <IconActionButton
                label="Refresh source control"
                disabled={isRefreshing || !!scm.actionBusy}
                onClick={handleRefresh}
              >
                {isRefreshing ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <HugeiconsIcon
                    icon={Refresh01Icon}
                    size={14}
                    strokeWidth={1.9}
                    className={cn(refreshAnimating && "animate-spin")}
                  />
                )}
              </IconActionButton>
              <IconActionButton label="Close source control" onClick={onClose}>
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  size={14}
                  strokeWidth={1.9}
                />
              </IconActionButton>
            </div>
          </div>
          <div className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[11.5px] font-semibold leading-none text-foreground">
            <HugeiconsIcon
              icon={GitBranchIcon}
              size={11}
              strokeWidth={1.9}
              className="shrink-0 text-muted-foreground"
            />
            <span className="truncate">{repoLabel}</span>
          </div>
          {headerMeta ? (
            <div className="truncate pt-0.5 text-[10px] leading-tight text-muted-foreground">
              {headerMeta}
            </div>
          ) : null}
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
          body={scm.statusError ?? "Unknown source control error"}
          action={
            <Button size="sm" onClick={() => void scm.refresh()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {scm.panelState === "ready" && scm.status ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div className={cn("space-y-2.5", scm.compact ? "py-2" : "py-3")}>
              {scm.stagedEntries.length > 0 && (
                <ChangeGroup
                  title="Staged Changes"
                  entries={scm.stagedEntries}
                  selected={scm.selected}
                  actionBusy={scm.actionBusy}
                  compact={scm.compact}
                  defaultOpen
                  actionType="unstage"
                  onActionAll={scm.unstageAllEntries}
                  onSelect={scm.selectEntry}
                  onAction={scm.unstageEntry}
                />
              )}
              <ChangeGroup
                title="Changes"
                entries={scm.unstagedEntries}
                selected={scm.selected}
                actionBusy={scm.actionBusy}
                compact={scm.compact}
                defaultOpen
                actionType="stage"
                onActionAll={scm.stageAllEntries}
                onDiscardAll={scm.discardAllEntries}
                onSelect={scm.selectEntry}
                onAction={scm.stageEntry}
                onDiscard={scm.discardEntry}
              />
            </div>
          </ScrollArea>

          <Separator />

          <div
            className={cn(
              "relative border-t border-border/30 bg-card",
              scm.compact ? "space-y-1.5 p-2" : "space-y-2 p-3",
            )}
          >
            <div className="relative">
              <Textarea
                value={scm.commitMessage}
                onChange={(event) => scm.setCommitMessage(event.target.value)}
                onKeyDown={handleCommitShortcut}
                placeholder="Commit message"
                rows={1}
                className={cn(
                  "min-h-10 resize-none rounded-lg border border-border/60 bg-background/95 py-[11px] pl-2.5 pr-8 !text-[12px] leading-snug shadow-none placeholder:text-muted-foreground/80 focus-visible:border-border/60 focus-visible:ring-0",
                )}
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                <IconActionButton
                  label={scm.generateCommitMessageHint}
                  disabled={!scm.canGenerateCommitMessage}
                  side="top"
                  onClick={() => void scm.generateCommitMessage()}
                >
                  {scm.actionBusy === "generate-message" ? (
                    <Spinner className="size-3" />
                  ) : (
                    <HugeiconsIcon
                      icon={SparklesIcon}
                      size={12}
                      strokeWidth={2}
                    />
                  )}
                </IconActionButton>
              </div>
            </div>

            <div className="flex min-w-0 items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        canCommit ? "bg-emerald-500" : "bg-muted-foreground/45",
                      )}
                    />
                    <span className="truncate">{commitStatusLabel}</span>
                    <span className="shrink-0 text-muted-foreground/70">
                      {stagedCountLabel}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className={cn(SOURCE_CONTROL_TOOLTIP_CLASS, "text-[10.5px]")}
                >
                  {commitHint}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="min-w-0 shrink-0 truncate text-right text-muted-foreground/80">
                    {pushStatusLabel}
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className={cn(
                    SOURCE_CONTROL_TOOLTIP_CLASS,
                    "max-w-64 text-[10.5px]",
                  )}
                >
                  {pushHint}
                </TooltipContent>
              </Tooltip>
            </div>

            <CommitFeedback feedback={footerFeedback} />

            <div
              className={cn(
                "grid grid-cols-2",
                scm.compact ? "gap-1.5" : "gap-2",
              )}
            >
              <Button
                size={scm.compact ? "xs" : "sm"}
                className="w-full cursor-pointer disabled:cursor-not-allowed"
                disabled={!canCommit}
                title={commitDisabledReason ?? `Commit (${commitShortcut})`}
                onClick={() => void scm.commit()}
              >
                {scm.actionBusy === "commit" ? "Committing..." : "Commit"}
              </Button>
              <Button
                size={scm.compact ? "xs" : "sm"}
                variant="secondary"
                className="w-full cursor-pointer disabled:cursor-not-allowed"
                disabled={!scm.canPush || !!scm.actionBusy}
                title={pushDisabledReason}
                onClick={() => void scm.push()}
              >
                {scm.actionBusy === "push" ? "Pushing..." : "Push"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      </aside>
    </TooltipProvider>
  );
});

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
  compact,
  defaultOpen,
  actionType,
  onActionAll,
  onDiscardAll,
  onSelect,
  onAction,
  onDiscard,
}: {
  title: string;
  entries: SourceControlEntry[];
  selected: { path: string; mode: "-" | "+" } | null;
  actionBusy: string | null;
  compact: boolean;
  defaultOpen?: boolean;
  actionType: "stage" | "unstage";
  onActionAll: () => Promise<void>;
  onDiscardAll?: () => Promise<void>;
  onSelect: (entry: SourceControlEntry) => Promise<void>;
  onAction: (entry: SourceControlEntry) => Promise<void>;
  onDiscard?: (entry: SourceControlEntry) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? false);
  const actionIcon = actionType === "stage" ? PlusSignIcon : MinusSignIcon;
  const actionLabel = actionType === "stage" ? "Stage" : "Unstage";
  const isHeaderActionBusy = actionBusy === `${actionType}:all`;
  const isDiscardAllBusy = actionBusy === "discard:all";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-1">
      <div className={cn("flex items-center gap-2", compact ? "px-1.5" : "px-2")}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-muted-foreground transition-colors hover:text-foreground",
              "py-0.5",
            )}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={12}
                strokeWidth={2.15}
                className={cn(
                  "transition-transform",
                  isOpen && "rotate-90",
                )}
              />
            </span>
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em]">
              {title}
            </span>
            <span className="text-[10px] text-muted-foreground/80">
              {entries.length}
            </span>
          </button>
        </CollapsibleTrigger>

        <div className="flex items-center gap-0.5">
          {onDiscardAll ? (
            <IconActionButton
              label="Discard all changes"
              disabled={actionBusy !== null || entries.length === 0}
              onClick={() => void onDiscardAll()}
            >
              {isDiscardAllBusy ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon icon={Delete01Icon} size={11} strokeWidth={2} />
              )}
            </IconActionButton>
          ) : null}
          <IconActionButton
            label={`${actionLabel} all files`}
            disabled={actionBusy !== null || entries.length === 0}
            onClick={() => void onActionAll()}
          >
            {isHeaderActionBusy ? (
              <Spinner className="size-3" />
            ) : (
              <HugeiconsIcon icon={actionIcon} size={11} strokeWidth={2} />
            )}
          </IconActionButton>
        </div>
      </div>

      <CollapsibleContent>
        {entries.length > 0 && (
          <ul className="space-y-px">
            {entries.map((entry) => {
              const isSelected =
                selected?.path === entry.path && selected.mode === entry.mode;
              const fileName = basename(entry.path);
              const iconUrl = fileIconUrl(fileName);
              const pathLabel = entryPathLabel(entry);

              return (
                <li key={entry.key}>
                  <div
                    className={cn(
                      "group grid grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-2 rounded-sm border border-transparent transition-colors",
                      compact ? "px-2 py-0" : "px-2.5 py-px",
                      isSelected
                        ? "bg-accent/80 text-foreground"
                        : "hover:bg-accent/45",
                    )}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => void onSelect(entry)}
                          className={cn(
                            "flex min-w-0 cursor-pointer items-center gap-1.5 text-left",
                            compact ? "py-px" : "py-0.5",
                          )}
                        >
                          <div className="flex size-5 shrink-0 items-center justify-center rounded-md bg-black/20 ring-1 ring-inset ring-white/5">
                            {iconUrl ? (
                              <img
                                src={iconUrl}
                                alt=""
                                className="size-3.5 shrink-0"
                              />
                            ) : (
                              <span className="size-3.5 shrink-0" />
                            )}
                          </div>

                          <div className="flex min-w-0 flex-1 items-baseline gap-1.5 leading-none">
                            <span
                              className={cn(
                                "truncate text-[11.5px] font-medium leading-tight",
                                pathLabel
                                  ? "max-w-[55%] shrink-0"
                                  : "min-w-0 flex-1",
                              )}
                            >
                              {fileName}
                            </span>
                            {pathLabel ? (
                              <span className="min-w-0 flex-1 truncate text-[10px] leading-tight text-muted-foreground">
                                {pathLabel}
                              </span>
                            ) : null}
                          </div>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className={cn(
                          SOURCE_CONTROL_TOOLTIP_CLASS,
                          "text-[10.5px]",
                        )}
                      >
                        {`${actionLabel} ${entry.path}`}
                      </TooltipContent>
                    </Tooltip>

                    <EntryActions
                      entry={entry}
                      busy={actionBusy === `${actionType}:${entry.path}`}
                      discardBusy={actionBusy === `discard:${entry.path}`}
                      disabled={actionBusy !== null}
                      label={`${actionLabel} ${entry.path}`}
                      icon={actionIcon}
                      onClick={() => void onAction(entry)}
                      onDiscard={
                        onDiscard
                          ? () => void onDiscard(entry)
                          : undefined
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function EntryActions({
  entry,
  busy,
  discardBusy,
  disabled,
  label,
  icon,
  onClick,
  onDiscard,
}: {
  entry: SourceControlEntry;
  busy: boolean;
  discardBusy: boolean;
  disabled?: boolean;
  label: string;
  icon: typeof PlusSignIcon;
  onClick: () => void;
  onDiscard?: () => void;
}) {
  return (
    <div className="relative h-6 w-6 shrink-0 overflow-visible">
      <div
        className={cn(
          "absolute right-0 top-0 inline-flex h-6 min-w-6 items-center justify-center px-1 text-[10px] font-semibold tracking-[0.08em] opacity-90 transition-opacity group-hover:opacity-0",
          statusTone(entry.statusCode),
        )}
      >
        {entry.statusCode}
      </div>
      <div className="absolute right-0 top-0 z-10 flex items-center gap-0.5 rounded-md bg-card/95 opacity-0 transition-opacity group-hover:opacity-100">
        <IconActionButton
          label={label}
          disabled={disabled}
          side="top"
          onClick={onClick}
        >
          {busy ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={icon} size={11} strokeWidth={2} />
          )}
        </IconActionButton>
        {onDiscard ? (
          <IconActionButton
            label={`Discard ${entry.path}`}
            disabled={disabled}
            side="top"
            onClick={onDiscard}
          >
            {discardBusy ? (
              <Spinner className="size-3" />
            ) : (
              <HugeiconsIcon icon={Delete01Icon} size={11} strokeWidth={2} />
            )}
          </IconActionButton>
        ) : null}
      </div>
    </div>
  );
}

function IconActionButton({
  label,
  disabled,
  side = "left",
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  side?: "left" | "top";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          className="cursor-pointer rounded-md text-muted-foreground disabled:cursor-not-allowed"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className={cn(SOURCE_CONTROL_TOOLTIP_CLASS, "text-[10.5px]")}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function CommitFeedback({
  feedback,
}: {
  feedback: { tone: "error" | "success"; message: string } | null;
}) {
  const [visibleFeedback, setVisibleFeedback] = useState(feedback);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!feedback) {
      setIsVisible(false);
      return;
    }

    setVisibleFeedback(feedback);
    setIsVisible(true);

    const hideTimer = window.setTimeout(() => setIsVisible(false), 3600);
    const clearTimer = window.setTimeout(() => {
      setVisibleFeedback((current) =>
        current?.message === feedback.message && current.tone === feedback.tone
          ? null
          : current,
      );
    }, 3900);

    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [feedback]);

  if (!visibleFeedback) return null;

  const isError = visibleFeedback.tone === "error";

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-3 bottom-[calc(100%-0.35rem)] z-20 flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug shadow-lg shadow-black/15 backdrop-blur transition-all duration-200",
        isVisible
          ? "translate-y-0 opacity-100"
          : "translate-y-1 opacity-0",
        isError
          ? "border-destructive/30 bg-card/95 text-destructive"
          : "border-border/70 bg-card/95 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isError ? "bg-destructive" : "bg-emerald-500",
        )}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          isError ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {visibleFeedback.message}
      </span>
    </div>
  );
}
