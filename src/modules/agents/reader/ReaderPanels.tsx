/**
 * Phase 2 of the Reader: the live "working" card, the pinned to-do / plan
 * panel, the Changes panel (review and revert), compact steps and the extra
 * code block actions.
 */
import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/modules/explorer/lib/contextActions";
import { openTerminalLink } from "@/modules/terminal/lib/terminalFileLinks";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  ArrowDown01Icon,
  ArrowTurnBackwardIcon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  CheckmarkSquare02Icon,
  Delete02Icon,
  FileEditIcon,
  GitCompareIcon,
  Loading03Icon,
  Note01Icon,
  SquareIcon,
  TextIndentIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  type ChangedFile,
  changesSummary,
  combinedDiff,
  parseUnifiedDiff,
} from "./lib/changes";
import {
  type HeadFileChange,
  headChanges,
  revertFile,
} from "./lib/changesClient";
import type { ClaudeActivity } from "./lib/claudeActivity";
import { codeBlockPath, resolveBlockPath } from "./lib/codeBlockPath";
import { type InFlight, type LiveStep, liveTitle } from "./lib/liveStream";
import { displayPath, formatDuration, toolKind } from "./lib/readerView";
import { useClaudeDialog } from "./lib/screenStore";
import {
  keepPlanningOption,
  type SessionPlan,
  type SessionTodos,
} from "./lib/sessionPlan";
import type { ToolCall } from "./lib/transcript";
import type { CompactItem } from "./lib/viewMode";
import { answerDialog } from "./ReaderAction";
import {
  CopyButton,
  DiffView,
  FileChip,
  KIND_ICON,
  KIND_TONE,
  type ReaderContext,
  ReaderItems,
} from "./ReaderBlocks";

function useTicker(enabled: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [enabled, ms]);
  return now;
}

/** The card at the end of the turn Claude is working on: what runs now, and what already ran. */
export const LiveWorkCard = memo(function LiveWorkCard({
  flight,
  steps,
  activity,
  ctx,
  turnStartedAt,
}: {
  flight: InFlight | null;
  steps: LiveStep[];
  activity: ClaudeActivity | null;
  ctx: ReaderContext;
  turnStartedAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const now = useTicker(true);
  const call = flight?.nested ?? flight?.call ?? null;
  const kind = call ? toolKind(call.name) : null;
  const title = call ? liveTitle(call, ctx.cwd, ctx.home) : null;
  const parent =
    flight?.nested && flight.call
      ? liveTitle(flight.call, ctx.cwd, ctx.home)
      : null;
  const since = Date.parse(call?.timestamp ?? turnStartedAt ?? "");
  const elapsed = Number.isFinite(since)
    ? formatDuration(Math.max(0, now - since))
    : (activity?.elapsed ?? null);
  /** A finished spinner line ("Crunched for 3m") never labels live work. */
  const liveVerb = activity && !activity.done ? activity.verb : null;
  return (
    <section
      aria-live="polite"
      className="terax-reader-in terax-reader-live overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--agent-working)_35%,var(--border))] bg-card"
    >
      <div className="flex items-center gap-2.5 px-3.5 py-2">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-md",
            kind ? KIND_TONE[kind] : "bg-primary/12 text-primary",
          )}
        >
          <HugeiconsIcon
            icon={kind ? KIND_ICON[kind] : Loading03Icon}
            size={13}
            strokeWidth={1.8}
            className={cn(!kind && "terax-reader-spin")}
          />
        </span>
        <div className="min-w-0 flex-1">
          {parent && (
            <div className="truncate text-[11px] text-muted-foreground">
              {parent.verb}
              {parent.detail ? `: ${parent.detail}` : ""}
            </div>
          )}
          <div className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
            <span className="terax-reader-shimmer shrink-0 font-medium">
              {title ? title.verb : (liveVerb ?? "Thinking…")}
            </span>
            {title?.detail && (
              <span
                className={cn(
                  "min-w-0 truncate text-foreground/90",
                  title.mono && "terax-reader-mono text-[12px]",
                )}
                title={title.detail}
              >
                {title.detail}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11.5px] tabular-nums text-muted-foreground">
          {activity?.tokens && (
            <span>
              {activity.direction === "up" ? "↑" : "↓"} {activity.tokens}
            </span>
          )}
          {elapsed && <span>{elapsed}</span>}
        </div>
      </div>
      {steps.length > 0 && (
        <div className="border-t border-border/50 px-3.5 py-1.5">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded text-[11.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={12}
              strokeWidth={2}
              className={cn("transition-transform", !open && "-rotate-90")}
            />
            {steps.length} step{steps.length === 1 ? "" : "s"} done this turn
          </button>
          {open && (
            <ol className="mt-1.5 flex flex-col gap-0.5">
              {steps.map((step) => (
                <li
                  key={step.id}
                  className="flex min-w-0 items-center gap-2 text-[12px]"
                >
                  <HugeiconsIcon
                    icon={step.error ? Delete02Icon : CheckmarkCircle02Icon}
                    size={12}
                    strokeWidth={2}
                    className={cn(
                      "shrink-0",
                      step.error
                        ? "text-[var(--terminal-ansi-red)]"
                        : "text-agent-done",
                    )}
                  />
                  <span className="shrink-0 text-muted-foreground">
                    {step.label}
                  </span>
                  {step.detail && (
                    <span
                      className={cn(
                        "min-w-0 truncate text-foreground/85",
                        step.mono && "terax-reader-mono text-[11.5px]",
                      )}
                    >
                      {step.detail}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
});

/** Status icon of one to-do item. */
function TodoIcon({
  status,
}: {
  status: SessionTodos["items"][number]["status"];
}) {
  return (
    <HugeiconsIcon
      icon={
        status === "completed"
          ? CheckmarkSquare02Icon
          : status === "in_progress"
            ? Loading03Icon
            : SquareIcon
      }
      size={14}
      strokeWidth={1.8}
      className={cn(
        "mt-[3px] shrink-0",
        status === "completed" && "text-agent-done",
        status === "in_progress" && "terax-reader-spin text-agent-working",
        status === "pending" && "text-muted-foreground",
      )}
    />
  );
}

/**
 * Claude's working plan, pinned: the to-do list with progress, and the latest
 * plan, with Approve / Keep planning while Claude asks to exit plan mode.
 */
export function WorkPanel({
  todos,
  plan,
  leafId,
  sticky,
}: {
  todos: SessionTodos | null;
  plan: SessionPlan | null;
  leafId: number;
  /** Pinned to the top of the pane's document; the full view's side panel isn't. */
  sticky: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const dialog = useClaudeDialog(leafId);
  const planDialog = dialog?.kind === "plan" ? dialog : null;
  const showPlan =
    plan !== null && (plan.status === "running" || planDialog !== null);
  if (!todos && !showPlan) return null;
  const pct = todos
    ? Math.round((todos.done / Math.max(1, todos.total)) * 100)
    : 0;
  const keep = planDialog ? keepPlanningOption(planDialog.options) : null;
  return (
    <section
      aria-label="Plan and to-dos"
      className={cn(
        "rounded-xl border border-border/60 bg-card",
        sticky &&
          "terax-reader-workpanel sticky top-2 z-[3] shadow-[0_10px_24px_-18px_rgba(0,0,0,0.9)]",
      )}
    >
      {todos && (
        <div className="px-4 py-2.5">
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
            className="flex w-full items-center gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <HugeiconsIcon
              icon={CheckListIcon}
              size={14}
              strokeWidth={1.8}
              className="text-agent-done"
            />
            <span className="text-[12px] font-semibold text-foreground">
              To-dos
            </span>
            <span className="text-[11.5px] tabular-nums text-muted-foreground">
              {todos.done} of {todos.total} done
            </span>
            <span className="mx-2 h-1.5 min-w-10 flex-1 overflow-hidden rounded-full bg-muted/70">
              <span
                className="block h-full rounded-full bg-agent-done transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </span>
            {collapsed && todos.active >= 0 && (
              <span className="hidden max-w-[40%] truncate text-[11.5px] text-foreground/85 sm:inline">
                {todos.items[todos.active].content}
              </span>
            )}
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={12}
              strokeWidth={2}
              className={cn(
                "shrink-0 text-muted-foreground transition-transform",
                collapsed && "-rotate-90",
              )}
            />
          </button>
          {!collapsed && (
            <ul className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
              {todos.items.map((todo, index) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: to-do lists have no ids
                  key={index}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-1.5 py-0.5 text-[12.5px] leading-relaxed",
                    todo.status === "completed" &&
                      "text-muted-foreground line-through decoration-muted-foreground/50",
                    todo.status === "in_progress" &&
                      "bg-[color-mix(in_oklab,var(--agent-working)_10%,transparent)] font-medium text-foreground",
                  )}
                >
                  <TodoIcon status={todo.status} />
                  <span>{todo.content}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {showPlan && plan && (
        <div className={cn("px-4 py-3", todos && "border-t border-border/50")}>
          <div className="mb-2 flex items-center gap-2">
            <HugeiconsIcon
              icon={Note01Icon}
              size={14}
              strokeWidth={1.8}
              className="text-[var(--terminal-ansi-magenta)]"
            />
            <span className="text-[12px] font-semibold text-foreground">
              Plan
            </span>
            <span className="text-[11.5px] text-muted-foreground">
              {planDialog ? "Waiting for your approval" : "Proposed"}
            </span>
            <span className="group/prose ml-auto">
              <CopyButton text={plan.markdown} className="opacity-100" />
            </span>
          </div>
          <div className="terax-reader-prose max-h-80 select-text overflow-y-auto text-[13.5px]">
            <MessageResponse>{plan.markdown}</MessageResponse>
          </div>
          {planDialog && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => answerDialog(leafId, planDialog, 1)}
                className="rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Approve plan
              </button>
              {keep !== null && (
                <button
                  type="button"
                  onClick={() => answerDialog(leafId, planDialog, keep)}
                  className="rounded-lg border border-border/70 px-3 py-1.5 text-[12px] text-foreground outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  Keep planning
                </button>
              )}
              <span className="text-[11px] text-muted-foreground">
                More choices are in the action card below.
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** "N steps" in Compact view: one line per run of tool calls, expandable to the cards. */
export function CompactSteps({
  calls,
  ctx,
}: {
  calls: ToolCall[];
  ctx: ReaderContext;
}) {
  const [open, setOpen] = useState(false);
  const failed = calls.filter((c) => c.status === "error").length;
  const running = calls.some((c) => c.status === "running");
  const kinds = [...new Set(calls.map((c) => toolKind(c.name)))].slice(0, 4);
  return (
    <div className="rounded-lg border border-border/50 bg-card/60">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="flex -space-x-1">
          {kinds.map((kind) => (
            <span
              key={kind}
              className={cn(
                "grid size-5 place-items-center rounded-md ring-2 ring-card",
                KIND_TONE[kind],
              )}
            >
              <HugeiconsIcon
                icon={KIND_ICON[kind]}
                size={11}
                strokeWidth={1.9}
              />
            </span>
          ))}
        </span>
        <span className="font-medium text-foreground/90">
          {calls.length} step{calls.length === 1 ? "" : "s"}
        </span>
        {failed > 0 && (
          <span className="text-[var(--terminal-ansi-red)]">
            · {failed} failed
          </span>
        )}
        {running && <span className="terax-reader-shimmer">· running</span>}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={12}
          strokeWidth={2}
          className={cn("ml-auto transition-transform", !open && "-rotate-90")}
        />
      </button>
      {open && (
        <div className="border-t border-border/50 p-2">
          <ReaderItems
            blocks={calls.map((call) => ({ kind: "tool", id: call.id, call }))}
            ctx={ctx}
            nested
          />
        </div>
      )}
    </div>
  );
}

/** Compact view of one turn's blocks: prose stays, tool runs become steps lines. */
export function CompactItems({
  items,
  ctx,
}: {
  items: CompactItem[];
  ctx: ReaderContext;
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) =>
        item.kind === "steps" ? (
          <CompactSteps key={item.id} calls={item.calls} ctx={ctx} />
        ) : (
          <ReaderItems key={item.block.id} blocks={[item.block]} ctx={ctx} />
        ),
      )}
    </div>
  );
}

/** Insert / Open buttons the Reader adds to Claude's fenced code blocks. */
export function CodeBlockActions({
  code,
  lang,
  ctx,
  onInsert,
}: {
  code: string;
  lang: string;
  ctx: ReaderContext;
  onInsert: (fenced: string) => void;
}) {
  const named = useMemo(() => codeBlockPath(code, lang), [code, lang]);
  const path = named ? resolveBlockPath(named, ctx.cwd, ctx.home) : null;
  const [exists, setExists] = useState(false);
  useEffect(() => {
    setExists(false);
    if (!path) return;
    let live = true;
    void invoke<{ kind: string }>("fs_stat", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((stat) => live && setExists(stat.kind !== "dir"))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [path]);
  const button =
    "h-5 rounded px-1.5 text-[10px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40";
  return (
    <>
      {exists && path && (
        <button
          type="button"
          title={path}
          onClick={() => void openTerminalLink(path, ctx.cwd)}
          className={button}
        >
          Open file
        </button>
      )}
      <button
        type="button"
        title="Insert into the message box"
        onClick={() =>
          onInsert(`\n\`\`\`${lang === "text" ? "" : lang}\n${code}\n\`\`\`\n`)
        }
        className={button}
      >
        Insert
      </button>
    </>
  );
}

type HeadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; repoRoot: string; byPath: Map<string, HeadFileChange> }
  | { kind: "none" };

/**
 * Every file Claude changed in this chat: counts, combined diff, and Open /
 * Revert, with "Ask Claude to review" and "Copy summary" at the bottom.
 */
export function ChangesPanel({
  files,
  ctx,
  onReview,
  onClose,
}: {
  files: ChangedFile[];
  ctx: ReaderContext;
  onReview: (files: ChangedFile[]) => void;
  onClose?: () => void;
}) {
  const [head, setHead] = useState<HeadState>({ kind: "idle" });
  const [nonce, setNonce] = useState(0);
  const paths = useMemo(() => files.map((f) => f.path).join("\n"), [files]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `paths` is the joined file list; `nonce` re-reads after a revert
  useEffect(() => {
    if (!ctx.cwd || !paths) {
      setHead({ kind: "none" });
      return;
    }
    let live = true;
    setHead((h) => (h.kind === "ready" ? h : { kind: "loading" }));
    void headChanges(ctx.cwd, paths.split("\n"))
      .then((result) => {
        if (!live) return;
        setHead(result ? { kind: "ready", ...result } : { kind: "none" });
      })
      .catch(() => live && setHead({ kind: "none" }));
    return () => {
      live = false;
    };
  }, [ctx.cwd, paths, nonce]);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  return (
    <section
      aria-label="Changes in this chat"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <HugeiconsIcon
          icon={GitCompareIcon}
          size={14}
          strokeWidth={1.8}
          className="text-primary"
        />
        <span className="text-[12.5px] font-semibold text-foreground">
          Changes
        </span>
        <span className="text-[11.5px] tabular-nums text-muted-foreground">
          {files.length} file{files.length === 1 ? "" : "s"}
          {files.length > 0 && (
            <>
              {" · "}
              <span className="text-[var(--terminal-ansi-green)]">
                +{added}
              </span>{" "}
              <span className="text-[var(--terminal-ansi-red)]">
                −{removed}
              </span>
            </>
          )}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md px-2 py-0.5 text-[11.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Close
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {files.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12.5px] text-muted-foreground">
            Claude hasn't edited any files in this chat yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {files.map((file) => (
              <ChangedFileRow
                key={file.path}
                file={file}
                ctx={ctx}
                head={head}
                onReverted={refresh}
              />
            ))}
          </ul>
        )}
      </div>
      {files.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/60 px-3 py-2.5">
          <button
            type="button"
            onClick={() => onReview(files)}
            className="rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Ask Claude to review these changes
          </button>
          <SummaryButton files={files} ctx={ctx} />
        </div>
      )}
    </section>
  );
}

function SummaryButton({
  files,
  ctx,
}: {
  files: ChangedFile[];
  ctx: ReaderContext;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() =>
        void copyToClipboard(changesSummary(files, ctx.cwd, ctx.home)).then(
          () => setCopied(true),
        )
      }
      className={cn(
        "rounded-lg border border-border/70 px-3 py-1.5 text-[12px] text-foreground outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40",
        copied && "text-agent-done",
      )}
    >
      {copied ? "Copied" : "Copy summary"}
    </button>
  );
}

type RevertStep =
  | { kind: "idle" }
  | { kind: "confirm" }
  | { kind: "working" }
  | { kind: "done"; outcome: string }
  | { kind: "error"; message: string };

function ChangedFileRow({
  file,
  ctx,
  head,
  onReverted,
}: {
  file: ChangedFile;
  ctx: ReaderContext;
  head: HeadState;
  onReverted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [revert, setRevert] = useState<RevertStep>({ kind: "idle" });
  const live = head.kind === "ready" ? head.byPath.get(file.path) : undefined;
  const diff = useMemo(() => combinedDiff(file), [file]);
  const discard = useMemo(
    () => (live?.diffText ? parseUnifiedDiff(live.diffText) : []),
    [live],
  );
  const repoRoot = head.kind === "ready" ? head.repoRoot : null;
  const isNew = live ? !live.inHead : file.created;
  const unchanged =
    live?.inHead === true &&
    live.added === 0 &&
    live.removed === 0 &&
    !live.binary;
  const doRevert = () => {
    if (!repoRoot) return;
    setRevert({ kind: "working" });
    void revertFile(repoRoot, file.path, isNew)
      .then((outcome) => {
        setRevert({ kind: "done", outcome });
        onReverted();
      })
      .catch((error: unknown) =>
        setRevert({ kind: "error", message: String(error) }),
      );
  };
  return (
    <li className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Hide diff" : "Show diff"}
          onClick={() => setOpen((v) => !v)}
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={12}
            strokeWidth={2}
            className={cn("transition-transform", !open && "-rotate-90")}
          />
        </button>
        <HugeiconsIcon
          icon={FileEditIcon}
          size={13}
          strokeWidth={1.8}
          className="shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1">
          <FileChip path={file.path} ctx={ctx} />
        </span>
        {file.deleted && <Tag tone="red">deleted</Tag>}
        {!file.deleted && isNew && <Tag tone="green">new</Tag>}
        {unchanged && <Tag tone="muted">no changes now</Tag>}
        <span className="shrink-0 text-[11.5px] tabular-nums">
          <span className="text-[var(--terminal-ansi-green)]">
            +{live && !live.binary ? live.added : file.added}
          </span>{" "}
          <span className="text-[var(--terminal-ansi-red)]">
            −{live && !live.binary ? live.removed : file.removed}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>
          {file.edits} edit{file.edits === 1 ? "" : "s"}
          {live &&
          !live.binary &&
          (live.added !== file.added || live.removed !== file.removed)
            ? " · counts from git"
            : ""}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {!file.deleted && (
            <button
              type="button"
              onClick={() => void openTerminalLink(file.path, ctx.cwd)}
              className="rounded-md px-2 py-0.5 outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Open
            </button>
          )}
          {repoRoot && !unchanged && !file.deleted && (
            <button
              type="button"
              onClick={() => setRevert({ kind: "confirm" })}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 outline-none hover:bg-[color-mix(in_oklab,var(--terminal-ansi-red)_12%,transparent)] hover:text-[var(--terminal-ansi-red)] focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <HugeiconsIcon
                icon={ArrowTurnBackwardIcon}
                size={12}
                strokeWidth={1.8}
              />
              Revert file
            </button>
          )}
        </span>
      </div>
      {revert.kind === "confirm" && (
        <div className="border-t border-[color-mix(in_oklab,var(--terminal-ansi-red)_35%,var(--border))] bg-[color-mix(in_oklab,var(--terminal-ansi-red)_6%,transparent)] px-3 py-2.5">
          <p className="text-[12px] text-foreground">
            {isNew
              ? `Delete ${displayPath(file.path, ctx.cwd, ctx.home)}? It isn't in the last commit, so this removes the file.`
              : `Discard every uncommitted change to ${displayPath(file.path, ctx.cwd, ctx.home)} and restore the last committed version? This also drops changes you made yourself.`}
          </p>
          {!isNew && discard.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-md border border-border/50">
              <div className="px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                This will be discarded
              </div>
              <DiffView diff={discard} />
            </div>
          )}
          {live?.truncated && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              The preview is cut short; the whole diff will be discarded.
            </p>
          )}
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={doRevert}
              className="rounded-lg bg-[var(--terminal-ansi-red)] px-3 py-1.5 text-[12px] font-medium text-background outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {isNew ? "Delete file" : "Revert file"}
            </button>
            <button
              type="button"
              onClick={() => setRevert({ kind: "idle" })}
              className="rounded-lg border border-border/70 px-3 py-1.5 text-[12px] outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {revert.kind === "working" && (
        <p className="border-t border-border/40 px-3 py-2 text-[12px] text-muted-foreground">
          Reverting…
        </p>
      )}
      {revert.kind === "done" && (
        <p className="border-t border-border/40 px-3 py-2 text-[12px] text-agent-done">
          {revert.outcome === "deleted"
            ? "File deleted."
            : "Restored to the last commit."}
        </p>
      )}
      {revert.kind === "error" && (
        <p className="border-t border-border/40 px-3 py-2 text-[12px] text-[var(--terminal-ansi-red)]">
          {revert.message}
        </p>
      )}
      {open && (
        <div className="border-t border-border/40">
          {diff.length > 0 ? (
            <DiffView diff={diff} />
          ) : (
            <p className="px-3 py-2 text-[12px] text-muted-foreground">
              No diff recorded for this file.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Tag({
  tone,
  children,
}: {
  tone: "red" | "green" | "muted";
  children: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium",
        tone === "red" &&
          "bg-[color-mix(in_oklab,var(--terminal-ansi-red)_14%,transparent)] text-[var(--terminal-ansi-red)]",
        tone === "green" &&
          "bg-[color-mix(in_oklab,var(--terminal-ansi-green)_14%,transparent)] text-[var(--terminal-ansi-green)]",
        tone === "muted" && "bg-muted/60 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Compact / Detailed segmented toggle for the Reader header. */
export function ViewModeToggle({
  compact,
  onChange,
}: {
  compact: boolean;
  onChange: (compact: boolean) => void;
}) {
  const label = compact
    ? "Compact view: show every step (Detailed)"
    : "Detailed view: fold tool steps (Compact)";
  return (
    <button
      type="button"
      aria-pressed={compact}
      aria-label={label}
      title={label}
      onClick={() => onChange(!compact)}
      className={cn(
        "relative grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40",
        compact && "bg-primary/12 text-foreground",
      )}
    >
      <HugeiconsIcon icon={TextIndentIcon} size={14} strokeWidth={1.8} />
    </button>
  );
}

/** The header's "Changes" button with its file count. */
export function ChangesButton({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const label = count > 0 ? `Changes (${count} files)` : "Changes";
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cn(
        "relative grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40",
        open && "bg-primary/12 text-foreground",
      )}
    >
      <HugeiconsIcon icon={GitCompareIcon} size={14} strokeWidth={1.8} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-primary px-0.5 text-[9px] font-semibold tabular-nums text-primary-foreground">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
