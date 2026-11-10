import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  BubbleChatIcon,
  Cancel01Icon,
  ComputerTerminal01Icon,
  CpuIcon,
  Delete02Icon,
  File01Icon,
  Folder01Icon,
  GitBranchIcon,
  PencilEdit02Icon,
  Queue01Icon,
  SentIcon,
  ShieldUserIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PermissionMode } from "./lib/claudeFooter";
import {
  choiceForModel,
  MODEL_CHOICES,
  type ModeChoice,
  modeChoicesFor,
} from "./lib/composerControls";
import { type Mention, type MentionKind, mentionKey } from "./lib/mentions";
import {
  QUEUE_LIST_MAX,
  type QueuedPrompt,
  queueDisplay,
} from "./lib/promptQueue";
import { contextTone } from "./lib/sessionFacts";

export const MENTION_ICON: Record<MentionKind, typeof File01Icon> = {
  file: File01Icon,
  folder: Folder01Icon,
  "git-working": GitBranchIcon,
  "git-branch": GitBranchIcon,
  terminal: ComputerTerminal01Icon,
  chat: BubbleChatIcon,
};

/** Above the dropdown and the Reader's side panels. */
const MENU_Z = "z-[1000]";

/** The removable mention pills above the composer's text. */
export function MentionPills({
  mentions,
  onRemove,
}: {
  mentions: readonly Mention[];
  onRemove: (key: string) => void;
}) {
  if (mentions.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 pt-0.5" aria-label="Attached context">
      {mentions.map((m) => {
        const key = mentionKey(m);
        const context = m.kind !== "file" && m.kind !== "folder";
        return (
          <li
            key={key}
            title={context ? m.label : m.ref}
            className={cn(
              "group/pill flex h-6 max-w-[260px] items-center gap-1.5 rounded-md border pr-1 pl-1.5 text-[11.5px]",
              context
                ? "border-primary/35 bg-primary/10 text-foreground"
                : "border-border/70 bg-background/60 text-foreground/90",
            )}
          >
            <HugeiconsIcon
              icon={MENTION_ICON[m.kind]}
              size={12}
              strokeWidth={2}
              className={context ? "text-primary" : "text-muted-foreground"}
            />
            <span className="terax-reader-mono min-w-0 truncate">
              {m.label}
            </span>
            <button
              type="button"
              onClick={() => onRemove(key)}
              aria-label={`Remove ${m.label}`}
              className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2.4} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Messages waiting for Claude to go idle, inside the composer card: listed
 * while there are a few (edit, reorder, send now, remove), folded to an
 * "N queued" pill past that.
 */
export function QueueChips({
  items,
  paused = false,
  onResume,
  onEdit,
  onRemove,
  onMove,
  onSendNow,
}: {
  items: readonly QueuedPrompt[];
  /** Held after a manual Stop until the user resumes. */
  paused?: boolean;
  onResume?: () => void;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  onSendNow: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const foldable = items.length > QUEUE_LIST_MAX;
  // Opened past the limit, it folds again once the list is short; an empty
  // queue starts folded next time.
  if (open && !foldable) setOpen(false);
  if (items.length === 0) return null;
  const first = items[0];
  const listed = queueDisplay(items.length, open) === "list";
  const title = paused ? "Queue paused after Stop" : "Sends when Claude is idle";
  return (
    <section aria-label="Queued messages" className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2 text-[11.5px]">
        {foldable ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background/60 px-2.5 py-0.5 font-medium text-foreground/90 outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40"
            title={title}
          >
            <HugeiconsIcon icon={Queue01Icon} size={12} strokeWidth={2} />
            {items.length} queued
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={11}
              strokeWidth={2}
              className={cn("transition-transform", !open && "-rotate-90")}
            />
          </button>
        ) : (
          <span
            className="flex shrink-0 items-center gap-1.5 px-0.5 font-medium text-muted-foreground"
            title={title}
          >
            <HugeiconsIcon icon={Queue01Icon} size={12} strokeWidth={2} />
            {items.length} queued
          </span>
        )}
        {!listed && (
          <span
            className="min-w-0 flex-1 truncate text-muted-foreground"
            title={first.text}
          >
            {first.text || `${first.images.length} image(s)`}
            <span className="ml-1.5 text-foreground/70">
              +{items.length - 1} more
            </span>
          </span>
        )}
        {paused && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-agent-attention">
            <span className="size-1.5 rounded-full bg-agent-attention" />
            Paused after Stop
            {onResume && (
              <button
                type="button"
                onClick={onResume}
                className="rounded-md px-1.5 py-0.5 font-medium text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Resume
              </button>
            )}
          </span>
        )}
      </div>
      {listed && (
        <ol className="flex flex-col gap-1">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="group/q flex items-center gap-2 rounded-lg bg-background/50 px-2 py-1"
            >
              <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              {editing === item.id ? (
                <input
                  // biome-ignore lint/a11y/noAutofocus: editing starts from an explicit click
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onEdit(item.id, draft.trim() || item.text);
                      setEditing(null);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditing(null);
                    }
                  }}
                  onBlur={() => {
                    onEdit(item.id, draft.trim() || item.text);
                    setEditing(null);
                  }}
                  aria-label="Edit queued message"
                  className="h-6 min-w-0 flex-1 rounded border border-primary/50 bg-background px-1.5 text-[12.5px] outline-none"
                />
              ) : (
                <span
                  className="min-w-0 flex-1 truncate text-[12.5px]"
                  title={item.text}
                >
                  {item.text || `${item.images.length} image(s)`}
                  {item.mentions.length > 0 && (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      +{item.mentions.length} context
                    </span>
                  )}
                  {item.afterDialog && (
                    <span className="ml-1.5 rounded bg-[color-mix(in_oklab,var(--agent-attention)_14%,transparent)] px-1 text-[10.5px] text-agent-attention">
                      Will send after you answer Claude
                    </span>
                  )}
                </span>
              )}
              <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover/q:opacity-100 group-focus-within/q:opacity-100">
                <QueueButton
                  label="Move up"
                  icon={ArrowUp01Icon}
                  disabled={index === 0}
                  onClick={() => onMove(item.id, -1)}
                />
                <QueueButton
                  label="Move down"
                  icon={ArrowDown01Icon}
                  disabled={index === items.length - 1}
                  onClick={() => onMove(item.id, 1)}
                />
                <QueueButton
                  label="Edit"
                  icon={PencilEdit02Icon}
                  onClick={() => {
                    setDraft(item.text);
                    setEditing(item.id);
                  }}
                />
                <QueueButton
                  label="Remove"
                  icon={Delete02Icon}
                  onClick={() => onRemove(item.id)}
                />
              </div>
              <button
                type="button"
                onClick={() => onSendNow(item.id)}
                className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-primary/15 px-2.5 text-[12px] font-medium text-primary outline-none transition-colors hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-primary/50"
                title="Send now, even while Claude works (⌘Enter)"
              >
                <HugeiconsIcon icon={SentIcon} size={12} strokeWidth={2} />
                Send now
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function QueueButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof File01Icon;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-5 place-items-center rounded text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-30"
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={2} />
    </button>
  );
}

function ToolbarChip({
  children,
  title,
  busy,
  className,
  ...props
}: {
  children: ReactNode;
  title: string;
  busy?: boolean;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      title={title}
      {...props}
      className={cn(
        "flex h-7 max-w-[180px] items-center gap-1.5 rounded-lg border border-transparent px-2 text-[11.5px] font-medium text-muted-foreground outline-none transition-colors hover:border-border/70 hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/45 data-[state=open]:border-border/70 data-[state=open]:bg-foreground/[0.05] data-[state=open]:text-foreground disabled:opacity-50",
        className,
      )}
    >
      {children}
      {busy && (
        <span className="size-3 animate-spin rounded-full border-[1.5px] border-current/30 border-t-current" />
      )}
    </button>
  );
}

/** The model chip: shows the current model and switches with `/model`. */
export function ModelPicker({
  current,
  onPick,
  onAfterClose,
}: {
  current: string | null;
  onPick: (alias: string) => void;
  onAfterClose: () => void;
}) {
  const active = choiceForModel(current);
  const [other, setOther] = useState("");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarChip title="Model (sends /model)">
          <HugeiconsIcon icon={CpuIcon} size={13} strokeWidth={2} />
          <span className="terax-composer-label truncate">
            {current ?? "Model"}
          </span>
        </ToolbarChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        className={cn(MENU_Z, "w-72 rounded-2xl")}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onAfterClose();
        }}
      >
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
          Switch model
        </DropdownMenuLabel>
        {MODEL_CHOICES.map((choice) => (
          <DropdownMenuItem
            key={choice.alias}
            onSelect={() => onPick(choice.alias)}
            className="items-start rounded-xl py-1.5"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px]">{choice.label}</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {choice.detail}
              </span>
            </div>
            {active?.alias === choice.alias && (
              <HugeiconsIcon
                icon={Tick02Icon}
                size={14}
                className="mt-0.5 text-primary"
              />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <input
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && other.trim()) {
                e.preventDefault();
                onPick(other.trim());
                setOther("");
              }
            }}
            placeholder="Other model id…"
            aria-label="Other model id"
            className="terax-reader-mono h-7 min-w-0 flex-1 rounded-lg border border-border/70 bg-background px-2 text-[12px] outline-none focus:border-primary/60"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const MODE_TONE: Record<PermissionMode, string> = {
  default: "text-muted-foreground",
  acceptEdits: "text-[var(--terminal-ansi-green)]",
  plan: "text-[var(--terminal-ansi-magenta)]",
  auto: "text-[var(--terminal-ansi-yellow)]",
  bypass: "text-[var(--terminal-ansi-red)]",
};

/** The mode pill: shows Claude's permission mode and cycles Shift+Tab to change it. */
export function ModePicker({
  current,
  switching,
  onPick,
  onAfterClose,
}: {
  current: PermissionMode | null;
  switching: boolean;
  onPick: (mode: PermissionMode) => void;
  onAfterClose: () => void;
}) {
  const choices: ModeChoice[] = modeChoicesFor(current);
  const label =
    choices.find((c) => c.mode === current)?.label ??
    (current === null ? "Mode" : current);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarChip
          title="Permission mode (cycles Shift+Tab in the terminal)"
          busy={switching}
          disabled={switching}
          className={current ? MODE_TONE[current] : undefined}
        >
          <HugeiconsIcon icon={ShieldUserIcon} size={13} strokeWidth={2} />
          <span className="terax-composer-label truncate">{label}</span>
        </ToolbarChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        className={cn(MENU_Z, "w-64 rounded-2xl")}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onAfterClose();
        }}
      >
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
          Permission mode
        </DropdownMenuLabel>
        {choices.map((choice) => (
          <DropdownMenuItem
            key={choice.mode}
            onSelect={() => onPick(choice.mode)}
            className="items-start rounded-xl py-1.5"
          >
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full bg-current",
                MODE_TONE[choice.mode],
              )}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px]">{choice.label}</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {choice.detail}
              </span>
            </div>
            {current === choice.mode && (
              <HugeiconsIcon
                icon={Tick02Icon}
                size={14}
                className="mt-0.5 text-primary"
              />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A small ring showing how full Claude's context window is. */
export function ContextMiniMeter({ percent }: { percent: number | null }) {
  if (percent === null) return null;
  const clamped = Math.max(0, Math.min(100, percent));
  const tone = contextTone(clamped);
  const color =
    tone === "high"
      ? "var(--terminal-ansi-red)"
      : tone === "warn"
        ? "var(--terminal-ansi-yellow)"
        : "var(--primary)";
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <span
      className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground"
      title={`Context used: ${Math.round(clamped)}%`}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.18"
          strokeWidth="2"
        />
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
          transform="rotate(-90 9 9)"
        />
      </svg>
      {Math.round(clamped)}%
    </span>
  );
}

/** Briefly shows `message` and calls `onDone` after it fades. */
export function useTransientMessage(timeoutMs = 4000) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = useCallback(
    (text: string | null) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(text);
      if (text) timer.current = setTimeout(() => setMessage(null), timeoutMs);
    },
    [timeoutMs],
  );
  return [message, show] as const;
}
