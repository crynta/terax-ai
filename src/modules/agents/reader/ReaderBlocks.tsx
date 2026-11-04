import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import { LinkifiedText } from "@/components/ai-elements/markdown-link";
import { copyToClipboard } from "@/modules/explorer/lib/contextActions";
import { openTerminalLink } from "@/modules/terminal/lib/terminalFileLinks";
import { useFileDiff } from "./ReaderFileDiff";
import {
  AiBrain01Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  CheckmarkSquare02Icon,
  ComputerTerminal01Icon,
  File01Icon,
  FileAddIcon,
  FileSearchIcon,
  Globe02Icon,
  Image01Icon,
  InformationCircleIcon,
  Loading03Icon,
  PencilEdit02Icon,
  Plug01Icon,
  RoboticIcon,
  Search01Icon,
  SquareIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { proseStructure, readTimeLabel } from "./lib/proseStructure";
import { mergeThinking } from "./lib/readerDoc";
import {
  bashOutput,
  compactDiff,
  diffStats,
  displayPath,
  formatDuration,
  groupReaderBlocks,
  numberDiff,
  type ReaderItem,
  spanMs,
  type ToolKind,
  todoItems,
  toolKind,
  toolTitle,
} from "./lib/readerView";
import type { ImageRef, ReaderBlock, ToolCall } from "./lib/transcript";
import { readTranscriptImage } from "./lib/transcriptClient";

export type Icon = Parameters<typeof HugeiconsIcon>[0]["icon"];

export const KIND_ICON: Record<ToolKind, Icon> = {
  bash: ComputerTerminal01Icon,
  read: File01Icon,
  edit: PencilEdit02Icon,
  write: FileAddIcon,
  search: Search01Icon,
  web: Globe02Icon,
  task: RoboticIcon,
  todo: CheckListIcon,
  mcp: Plug01Icon,
  other: Wrench01Icon,
};

/** Accent per tool family, as a theme colour token. */
export const KIND_TONE: Record<ToolKind, string> = {
  bash: "text-[var(--terminal-ansi-cyan)] bg-[color-mix(in_oklab,var(--terminal-ansi-cyan)_14%,transparent)]",
  read: "text-[var(--terminal-ansi-blue)] bg-[color-mix(in_oklab,var(--terminal-ansi-blue)_14%,transparent)]",
  edit: "text-[var(--terminal-ansi-yellow)] bg-[color-mix(in_oklab,var(--terminal-ansi-yellow)_14%,transparent)]",
  write:
    "text-[var(--terminal-ansi-green)] bg-[color-mix(in_oklab,var(--terminal-ansi-green)_14%,transparent)]",
  search:
    "text-[var(--terminal-ansi-blue)] bg-[color-mix(in_oklab,var(--terminal-ansi-blue)_14%,transparent)]",
  web: "text-[var(--terminal-ansi-magenta)] bg-[color-mix(in_oklab,var(--terminal-ansi-magenta)_14%,transparent)]",
  task: "text-[var(--terminal-ansi-magenta)] bg-[color-mix(in_oklab,var(--terminal-ansi-magenta)_14%,transparent)]",
  todo: "text-[var(--terminal-ansi-green)] bg-[color-mix(in_oklab,var(--terminal-ansi-green)_14%,transparent)]",
  mcp: "text-[var(--terminal-ansi-cyan)] bg-[color-mix(in_oklab,var(--terminal-ansi-cyan)_14%,transparent)]",
  other: "text-muted-foreground bg-muted/60",
};

export type ReaderContext = {
  cwd: string | null;
  home: string | null;
  /** Session whose transcript holds pasted images. */
  sessionId: string | null;
  /** Last "Expand all / Collapse all" request; cards follow it when it changes. */
  toolsOpen: { open: boolean; at: number } | null;
};

/** Opens or closes a card when the Reader asks every tool card to. */
function useExpandAll(
  ctx: ReaderContext,
  setOpen: (open: boolean) => void,
): void {
  const at = ctx.toolsOpen?.at;
  const open = ctx.toolsOpen?.open;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the request timestamp is the trigger
  useEffect(() => {
    if (open !== undefined) setOpen(open);
  }, [at]);
}

export const ReaderItems = memo(function ReaderItems({
  blocks,
  ctx,
  nested = false,
}: {
  blocks: readonly ReaderBlock[];
  ctx: ReaderContext;
  nested?: boolean;
}) {
  const items = useMemo(
    () => groupReaderBlocks(mergeThinking(blocks)),
    [blocks],
  );
  return (
    <div className={cn("flex flex-col", nested ? "gap-2" : "gap-3")}>
      {items.map((item) => (
        <ReaderItemView
          key={item.kind === "explore" ? item.id : item.block.id}
          item={item}
          ctx={ctx}
        />
      ))}
    </div>
  );
});

function ReaderItemView({
  item,
  ctx,
}: {
  item: ReaderItem;
  ctx: ReaderContext;
}) {
  if (item.kind === "explore")
    return <ExploreCard calls={item.calls} ctx={ctx} />;
  const block = item.block;
  switch (block.kind) {
    case "text":
      return <ProseCard text={block.text} />;
    case "thinking":
      return <ThinkingCard text={block.text} durationMs={block.durationMs} />;
    case "tool":
      return <ToolCard call={block.call} ctx={ctx} />;
    case "image":
      return block.ref && ctx.sessionId ? (
        <ImageStrip sessionId={ctx.sessionId} images={[block.ref]} />
      ) : (
        <NeutralCard icon={Image01Icon}>Image attached</NeutralCard>
      );
    case "notice":
      return (
        <NeutralCard icon={InformationCircleIcon}>
          <pre className="terax-reader-mono whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/90">
            {block.text}
          </pre>
        </NeutralCard>
      );
    default:
      return null;
  }
}

const ProseCard = memo(function ProseCard({ text }: { text: string }) {
  const structure = useMemo(() => proseStructure(text), [text]);
  const readTime = useMemo(() => readTimeLabel(text), [text]);
  return (
    <article
      aria-label="Claude's reply"
      className="terax-reader-in group/prose relative rounded-[14px] border border-border/60 bg-card px-5 py-3.5 shadow-[0_1px_0_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]"
    >
      {/* Floats over the card's top-right corner, so it never adds a row. */}
      <div className="terax-reader-card-tools">
        {readTime && (
          <span className="px-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover/prose:opacity-100">
            {readTime}
          </span>
        )}
        <CopyButton text={text} />
      </div>
      <div className="terax-reader-prose select-text">
        {structure.preamble && (
          <MessageResponse>{structure.preamble}</MessageResponse>
        )}
        {structure.sections.map((section, i) => (
          <section
            // Sections are positional within one immutable reply.
            // biome-ignore lint/suspicious/noArrayIndexKey: stable for a given text
            key={i}
            className="terax-reader-section"
          >
            <MessageResponse>
              {`### ${section.heading}\n\n${section.body}`}
            </MessageResponse>
          </section>
        ))}
      </div>
    </article>
  );
});

export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string | (() => string);
  label?: string;
  className?: string;
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
      onClick={(event) => {
        event.stopPropagation();
        const value = typeof text === "function" ? text() : text;
        void copyToClipboard(value).then(() => setCopied(true));
      }}
      className={cn(
        "rounded-md border border-transparent px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground opacity-0 outline-none transition-[opacity,color,border-color] group-hover/prose:opacity-100 hover:border-border/70 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40",
        copied && "opacity-100 text-agent-done",
        className,
      )}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function ThinkingCard({
  text,
  durationMs,
}: {
  text: string;
  durationMs: number | null;
}) {
  const [open, setOpen] = useState(false);
  const label = durationMs
    ? `Thought for ${formatDuration(durationMs)}`
    : "Thinking";
  const hasText = text.trim().length > 0;
  if (!hasText) {
    return (
      <div className="terax-reader-in inline-flex w-fit items-center gap-1.5 rounded-full border border-dashed border-border/70 px-2.5 py-1 text-[11.5px] text-muted-foreground">
        <HugeiconsIcon icon={AiBrain01Icon} size={13} strokeWidth={1.75} />
        {label}
      </div>
    );
  }
  return (
    <div className="terax-reader-in rounded-lg border border-dashed border-border/70 bg-muted/15">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <HugeiconsIcon icon={AiBrain01Icon} size={14} strokeWidth={1.75} />
        <span className="font-medium">{label}</span>
        <Chevron open={open} className="ml-auto" />
      </button>
      {open && (
        <div className="terax-reader-thinking select-text px-4 pb-3">
          <MessageResponse>{text}</MessageResponse>
        </div>
      )}
    </div>
  );
}

function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <HugeiconsIcon
      icon={ArrowDown01Icon}
      size={14}
      strokeWidth={1.75}
      className={cn(
        "shrink-0 text-muted-foreground transition-transform duration-[var(--dur-fast)]",
        !open && "-rotate-90",
        className,
      )}
    />
  );
}

function StatusBadge({ call }: { call: ToolCall }) {
  if (call.status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-agent-working">
        <HugeiconsIcon
          icon={Loading03Icon}
          size={13}
          className="animate-spin"
        />
        running
      </span>
    );
  }
  if (call.status === "error" || call.interrupted) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--terminal-ansi-red)]">
        <HugeiconsIcon icon={AlertCircleIcon} size={13} strokeWidth={2} />
        {call.interrupted ? "interrupted" : "failed"}
      </span>
    );
  }
  return (
    <HugeiconsIcon
      icon={CheckmarkCircle02Icon}
      size={14}
      strokeWidth={1.9}
      className="text-agent-done"
      aria-label="done"
    />
  );
}

export function FileChip({ path, ctx }: { path: string; ctx: ReaderContext }) {
  const fileDiff = useFileDiff();
  const changed = fileDiff?.resolve(path) ?? null;
  return (
    <button
      type="button"
      title={changed ? `${path} — view changes` : path}
      onClick={(event) => {
        event.stopPropagation();
        // A file this chat changed opens its diff here; others open in the editor.
        if (changed && fileDiff) fileDiff.open(changed);
        else void openTerminalLink(path, ctx.cwd);
      }}
      className="terax-reader-mono min-w-0 truncate rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[12px] text-foreground outline-none transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {displayPath(path, ctx.cwd, ctx.home)}
    </button>
  );
}

function hasBody(call: ToolCall, kind: ToolKind): boolean {
  if (kind === "todo") return false;
  if (kind === "edit" || kind === "write") return !!call.diff?.length;
  if (kind === "task") return call.children.length > 0 || !!call.result;
  if (kind === "bash") return true;
  return !!call.result;
}

const ToolCard = memo(function ToolCard({
  call,
  ctx,
}: {
  call: ToolCall;
  ctx: ReaderContext;
}) {
  const kind = toolKind(call.name);
  const title = toolTitle(call, ctx.cwd, ctx.home);
  const expandable = hasBody(call, kind);
  const diffLines = call.diff?.length ?? 0;
  const [open, setOpen] = useState(
    call.status === "error" ||
      ((kind === "edit" || kind === "write") &&
        diffLines > 0 &&
        diffLines <= 60),
  );
  useExpandAll(ctx, (next) => setOpen(next && expandable));
  const stats = call.diff ? diffStats(call.diff) : null;
  const errored = call.status === "error";

  return (
    <div
      className={cn(
        "terax-reader-in overflow-hidden rounded-[12px] border bg-card/70",
        errored
          ? "border-[color-mix(in_oklab,var(--terminal-ansi-red)_45%,transparent)]"
          : "border-border/60",
      )}
    >
      <div className="relative flex min-w-0 items-center gap-2.5 px-3 py-2">
        {expandable && (
          // The whole row toggles; the file chip sits above this button.
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} ${title.label} details`}
            onClick={() => setOpen((v) => !v)}
            className="absolute inset-0 cursor-pointer outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
          />
        )}
        <span
          className={cn(
            "pointer-events-none grid size-6 shrink-0 place-items-center rounded-md",
            KIND_TONE[kind],
          )}
        >
          <HugeiconsIcon icon={KIND_ICON[kind]} size={13} strokeWidth={1.9} />
        </span>
        <span className="pointer-events-none shrink-0 text-[12px] font-medium text-muted-foreground">
          {title.label}
        </span>
        {title.path ? (
          <span className="relative z-[1] min-w-0">
            <FileChip path={title.path} ctx={ctx} />
          </span>
        ) : title.detail ? (
          <span
            className={cn(
              "pointer-events-none min-w-0 truncate text-[12.5px] text-foreground",
              title.mono && "terax-reader-mono text-[12px]",
            )}
            title={title.detail}
          >
            {title.detail}
          </span>
        ) : null}
        <span className="pointer-events-none ml-auto flex shrink-0 items-center gap-2 pl-2">
          {stats && (stats.added > 0 || stats.removed > 0) && (
            <span className="terax-reader-mono text-[11px] tabular-nums">
              <span className="text-[var(--terminal-ansi-green)]">
                +{stats.added}
              </span>{" "}
              <span className="text-[var(--terminal-ansi-red)]">
                −{stats.removed}
              </span>
            </span>
          )}
          <StatusBadge call={call} />
          {expandable && <Chevron open={open} />}
        </span>
      </div>
      {kind === "todo" && <TodoList input={call.input} />}
      {expandable && open && (
        <div className="border-t border-border/50">
          <ToolBody call={call} kind={kind} ctx={ctx} />
        </div>
      )}
    </div>
  );
});

function ToolBody({
  call,
  kind,
  ctx,
}: {
  call: ToolCall;
  kind: ToolKind;
  ctx: ReaderContext;
}) {
  if ((kind === "edit" || kind === "write") && call.diff) {
    return <DiffView diff={call.diff} />;
  }
  if (kind === "bash") {
    const command =
      typeof (call.input as { command?: unknown } | null)?.command === "string"
        ? (call.input as { command: string }).command
        : null;
    const { stdout, stderr } = bashOutput(call);
    return (
      <div className="bg-[var(--reader-code-bg)]">
        {command && (
          <pre className="terax-reader-mono whitespace-pre-wrap break-words border-b border-border/40 px-3.5 py-2 text-[12px] leading-relaxed text-foreground">
            <span className="select-none text-[var(--terminal-ansi-green)]">
              ${" "}
            </span>
            {command}
          </pre>
        )}
        <OutputBlock
          text={stdout}
          empty={call.status === "running" ? "Running…" : "No output"}
        />
        {stderr && <OutputBlock text={stderr} tone="error" />}
      </div>
    );
  }
  if (kind === "task") {
    const duration = spanMs(call.timestamp, null);
    return (
      <div className="flex flex-col gap-3 px-3.5 py-3">
        {call.children.length > 0 ? (
          <div className="border-l border-border/70 pl-3">
            <ReaderItems blocks={call.children} ctx={ctx} nested />
          </div>
        ) : null}
        {call.result && (
          <div className="rounded-lg border border-border/50 bg-background/40 px-4 py-3">
            <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Subagent report{duration ? ` · ${formatDuration(duration)}` : ""}
            </div>
            <div className="terax-reader-prose select-text text-[13px]">
              <MessageResponse>{call.result}</MessageResponse>
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="bg-[var(--reader-code-bg)]">
      <OutputBlock
        text={call.result ?? ""}
        tone={call.status === "error" ? "error" : undefined}
      />
    </div>
  );
}

function OutputBlock({
  text,
  tone,
  empty = "No output",
}: {
  text: string;
  tone?: "error";
  empty?: string;
}) {
  const trimmed = text.replace(/\s+$/, "");
  return (
    <div className="group/prose relative">
      <pre
        className={cn(
          "terax-reader-mono max-h-80 select-text overflow-auto whitespace-pre-wrap break-words px-3.5 py-2.5 text-[12px] leading-relaxed",
          tone === "error"
            ? "bg-[color-mix(in_oklab,var(--terminal-ansi-red)_9%,transparent)] text-[color-mix(in_oklab,var(--terminal-ansi-red)_70%,var(--foreground))]"
            : "text-foreground/90",
          !trimmed && "italic text-muted-foreground",
        )}
      >
        {trimmed ? <LinkifiedText text={trimmed} /> : empty}
      </pre>
      {trimmed && (
        <CopyButton
          text={trimmed}
          className="absolute top-1.5 right-2 bg-[var(--reader-code-bg)]"
        />
      )}
    </div>
  );
}

export function DiffView({ diff }: { diff: NonNullable<ToolCall["diff"]> }) {
  const rows = useMemo(() => compactDiff(numberDiff(diff)), [diff]);
  // Each line's (old, new) number pair is unique; a gap is keyed by the line before it.
  let lastKey = "start";
  return (
    <div className="terax-reader-mono max-h-[28rem] overflow-auto bg-[var(--reader-code-bg)] text-[12px] leading-[1.6]">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((row) => {
            if (row.kind !== "gap")
              lastKey = `o${row.oldNo ?? "_"}n${row.newNo ?? "_"}`;
            return row.kind === "gap" ? (
              <tr key={`gap-${lastKey}`} className="text-muted-foreground">
                <td
                  colSpan={4}
                  className="select-none bg-muted/25 px-3 py-0.5 text-[11px]"
                >
                  ⋯ {row.hidden} unchanged line{row.hidden === 1 ? "" : "s"}
                </td>
              </tr>
            ) : (
              <tr
                key={lastKey}
                className={cn(
                  row.kind === "add" && "terax-reader-diff-add",
                  row.kind === "remove" && "terax-reader-diff-remove",
                )}
              >
                <td className="terax-reader-diff-gutter w-10 select-none px-2 text-right align-top text-[11px] text-muted-foreground/70 tabular-nums">
                  {row.oldNo ?? ""}
                </td>
                <td className="terax-reader-diff-gutter w-10 select-none px-2 text-right align-top text-[11px] text-muted-foreground/70 tabular-nums">
                  {row.newNo ?? ""}
                </td>
                <td className="terax-reader-diff-sign w-4 select-none align-top text-muted-foreground">
                  {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}
                </td>
                <td className="whitespace-pre-wrap break-all pr-3 align-top text-foreground/90">
                  {row.text || " "}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TodoList({ input }: { input: unknown }) {
  const todos = todoItems(input);
  if (todos.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 border-t border-border/50 px-3.5 py-2.5">
      {todos.map((todo, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: todo lists have no ids
          key={index}
          className={cn(
            "flex items-start gap-2 text-[12.5px] leading-relaxed",
            todo.status === "completed" &&
              "text-muted-foreground line-through decoration-muted-foreground/50",
            todo.status === "in_progress" && "font-medium text-foreground",
          )}
        >
          <HugeiconsIcon
            icon={
              todo.status === "completed"
                ? CheckmarkSquare02Icon
                : todo.status === "in_progress"
                  ? Loading03Icon
                  : SquareIcon
            }
            size={14}
            strokeWidth={1.8}
            className={cn(
              "mt-[3px] shrink-0",
              todo.status === "completed" && "text-agent-done",
              todo.status === "in_progress" && "text-agent-working",
              todo.status === "pending" && "text-muted-foreground",
            )}
          />
          <span>{todo.content}</span>
        </li>
      ))}
    </ul>
  );
}

function ExploreCard({
  calls,
  ctx,
}: {
  calls: ToolCall[];
  ctx: ReaderContext;
}) {
  const [open, setOpen] = useState(false);
  useExpandAll(ctx, setOpen);
  const running = calls.some((c) => c.status === "running");
  const failed = calls.filter((c) => c.status === "error").length;
  const names = calls
    .map((c) => toolTitle(c, ctx.cwd, ctx.home).detail)
    .filter((d): d is string => !!d);
  const preview = names.slice(0, 3).map((n) => n.split("/").pop() ?? n);
  return (
    <div className="terax-reader-in overflow-hidden rounded-[12px] border border-border/60 bg-card/70">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      >
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-md",
            KIND_TONE.read,
          )}
        >
          <HugeiconsIcon icon={FileSearchIcon} size={13} strokeWidth={1.9} />
        </span>
        <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
          Explored {calls.length} {calls.length === 1 ? "item" : "items"}
        </span>
        <span className="terax-reader-mono min-w-0 truncate text-[12px] text-foreground/80">
          {preview.join(", ")}
          {names.length > preview.length
            ? ` +${names.length - preview.length}`
            : ""}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          {failed > 0 && (
            <span className="text-[11px] text-[var(--terminal-ansi-red)]">
              {failed} failed
            </span>
          )}
          {running ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={13}
              className="animate-spin text-agent-working"
            />
          ) : (
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={14}
              strokeWidth={1.9}
              className="text-agent-done"
            />
          )}
          <Chevron open={open} />
        </span>
      </button>
      {open && (
        <ul className="flex flex-col border-t border-border/50 py-1">
          {calls.map((call) => {
            const kind = toolKind(call.name);
            const title = toolTitle(call, ctx.cwd, ctx.home);
            return (
              <li
                key={call.id}
                className="flex min-w-0 items-center gap-2 px-3.5 py-1"
              >
                <HugeiconsIcon
                  icon={KIND_ICON[kind]}
                  size={12}
                  strokeWidth={1.9}
                  className="shrink-0 text-muted-foreground"
                />
                <span className="shrink-0 text-[11.5px] text-muted-foreground">
                  {title.label}
                </span>
                {title.path ? (
                  <FileChip path={title.path} ctx={ctx} />
                ) : (
                  <span className="terax-reader-mono min-w-0 truncate text-[12px] text-foreground/85">
                    {title.detail}
                  </span>
                )}
                {call.status === "error" && (
                  <HugeiconsIcon
                    icon={AlertCircleIcon}
                    size={12}
                    className="ml-auto shrink-0 text-[var(--terminal-ansi-red)]"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NeutralCard({ icon, children }: { icon: Icon; children: ReactNode }) {
  return (
    <div className="terax-reader-in flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
      <HugeiconsIcon
        icon={icon}
        size={14}
        strokeWidth={1.8}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const THUMB_MAX = 6;

/** Pasted images as thumbnails; click opens a full-size lightbox. */
export function ImageStrip({
  sessionId,
  images,
}: {
  sessionId: string;
  images: readonly ImageRef[];
}) {
  const [zoomed, setZoomed] = useState<string | null>(null);
  if (images.length === 0) return null;
  const shown = images.slice(0, THUMB_MAX);
  return (
    <div className="flex flex-wrap gap-2">
      {shown.map((ref) => (
        <ImageThumb
          key={`${ref.offset}:${ref.index}`}
          sessionId={sessionId}
          imageRef={ref}
          onOpen={setZoomed}
        />
      ))}
      {images.length > THUMB_MAX && (
        <span className="self-end text-[11.5px] text-muted-foreground">
          +{images.length - THUMB_MAX} more
        </span>
      )}
      {zoomed && <Lightbox src={zoomed} onClose={() => setZoomed(null)} />}
    </div>
  );
}

function ImageThumb({
  sessionId,
  imageRef,
  onOpen,
}: {
  sessionId: string;
  imageRef: ImageRef;
  onOpen: (src: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const host = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    // Load when scrolled near: base64 screenshots are hundreds of KB each.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        readTranscriptImage(sessionId, imageRef.offset, imageRef.index)
          .then((url) => {
            if (!cancelled) setSrc(url);
          })
          .catch(() => {
            if (!cancelled) setFailed(true);
          });
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [sessionId, imageRef.offset, imageRef.index]);
  return (
    <button
      ref={host}
      type="button"
      disabled={!src}
      onClick={() => src && onOpen(src)}
      aria-label="Open image"
      className="group/img relative grid h-[148px] min-w-[120px] max-w-[260px] place-items-center overflow-hidden rounded-lg border border-border/70 bg-background/60 outline-none transition-[border-color,box-shadow] hover:border-primary/60 hover:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_18%,transparent)] focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-default"
    >
      {src ? (
        <img
          src={src}
          alt="Pasted screenshot"
          className="h-full w-full object-cover object-top"
          draggable={false}
        />
      ) : failed ? (
        <span className="flex items-center gap-1.5 px-3 text-[11.5px] text-muted-foreground">
          <HugeiconsIcon icon={Image01Icon} size={14} />
          Image unavailable
        </span>
      ) : (
        <span className="h-full w-full animate-pulse bg-muted/40" />
      )}
    </button>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it (window listener)
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image"
      onClick={onClose}
      className="fixed inset-0 z-[1000] grid cursor-zoom-out place-items-center bg-black/85 p-8"
    >
      <img
        src={src}
        alt="Pasted screenshot, full size"
        className="max-h-full max-w-full rounded-lg shadow-2xl"
      />
    </div>,
    document.body,
  );
}
