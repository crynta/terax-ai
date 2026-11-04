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
  ArrowLeft01Icon,
  BubbleChatAddIcon,
  Cancel01Icon,
  Clock01Icon,
  Copy01Icon,
  Download04Icon,
  FileExportIcon,
  GitForkIcon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PlayIcon,
  RotateLeft01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CompactBanner } from "./lib/contextBanner";
import type { RewindStage } from "./lib/rewindDriver";

const MENU_Z = "z-[1000]";

export function HistoryButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={open}
      onClick={onToggle}
      aria-label="Chat history"
      title="Chat history"
      className={cn(
        "relative grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40",
        open && "bg-primary/12 text-foreground",
      )}
    >
      <HugeiconsIcon icon={Clock01Icon} size={14} strokeWidth={1.8} />
    </button>
  );
}

/** The header's overflow menu: new chat, rename, export, resume or fork. */
export function ConversationMenu({
  canAct,
  onNewChat,
  onRename,
  onCopyMarkdown,
  onSaveMarkdown,
  onClaudeExport,
  onFork,
  onAfterClose,
}: {
  /** Claude is idle and linked: commands can be sent now. */
  canAct: boolean;
  onNewChat: () => void;
  onRename: () => void;
  onCopyMarkdown: () => void;
  onSaveMarkdown: () => void;
  onClaudeExport: () => void;
  onFork: (() => void) | null;
  onAfterClose: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Chat actions"
          title="Chat actions"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} size={14} strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn(MENU_Z, "w-64 rounded-2xl")}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onAfterClose();
        }}
      >
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
          This chat
        </DropdownMenuLabel>
        <MenuRow
          icon={BubbleChatAddIcon}
          label="New chat"
          detail={
            canAct ? "Clears the conversation (/clear)" : "When Claude is idle"
          }
          disabled={!canAct}
          onSelect={onNewChat}
        />
        <MenuRow icon={PencilEdit02Icon} label="Rename…" onSelect={onRename} />
        {onFork && (
          <MenuRow
            icon={GitForkIcon}
            label="Fork into a new tab"
            detail="A copy you can take elsewhere"
            onSelect={onFork}
          />
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
          Export
        </DropdownMenuLabel>
        <MenuRow
          icon={Copy01Icon}
          label="Copy as Markdown"
          onSelect={onCopyMarkdown}
        />
        <MenuRow
          icon={Download04Icon}
          label="Save Markdown to Downloads"
          onSelect={onSaveMarkdown}
        />
        <MenuRow
          icon={FileExportIcon}
          label="Claude's /export"
          detail={
            canAct ? "Opens Claude's export options" : "When Claude is idle"
          }
          disabled={!canAct}
          onSelect={onClaudeExport}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuRow({
  icon,
  label,
  detail,
  disabled,
  onSelect,
}: {
  icon: typeof PlayIcon;
  label: string;
  detail?: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={onSelect}
      className="items-start gap-2.5 rounded-xl py-1.5"
    >
      <HugeiconsIcon
        icon={icon}
        size={14}
        strokeWidth={1.8}
        className="mt-0.5"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px]">{label}</span>
        {detail && (
          <span className="text-[11px] font-normal text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
    </DropdownMenuItem>
  );
}

/** The header title turned into a text field while renaming. */
export function RenameField({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value);
        else onCancel();
      }}
    >
      <input
        ref={input}
        value={value}
        maxLength={120}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label="Chat name"
        className="h-7 min-w-0 flex-1 rounded-md border border-primary/50 bg-background px-2 text-[13px] font-semibold text-foreground outline-none ring-2 ring-primary/20"
      />
      <button
        type="submit"
        aria-label="Save name"
        className="grid size-7 place-items-center rounded-md bg-primary/15 text-primary outline-none hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel rename"
        className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
      </button>
    </form>
  );
}

export type PromptAction = "edit" | "restore" | "fork";

/**
 * Hover toolbar on a prompt card. "Edit & re-run" asks whether code goes
 * back too; "Restore checkpoint" asks to confirm.
 */
export function PromptActions({
  disabled,
  onAction,
}: {
  /** Why the actions can't run now (Claude busy, past chat), or null. */
  disabled: string | null;
  onAction: (action: PromptAction, alsoCode: boolean) => void;
}) {
  const [asking, setAsking] = useState<"edit" | "restore" | null>(null);
  if (asking) {
    return (
      <div className="terax-reader-in flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-background/80 px-2.5 py-2 text-[11.5px]">
        <span className="text-foreground">
          {asking === "edit"
            ? "Rewind to before this prompt to edit it. Also restore code?"
            : "Restore code and conversation to before this prompt?"}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {asking === "edit" ? (
            <>
              <SmallButton
                onClick={() => {
                  setAsking(null);
                  onAction("edit", false);
                }}
              >
                Conversation only
              </SmallButton>
              <SmallButton
                tone="primary"
                onClick={() => {
                  setAsking(null);
                  onAction("edit", true);
                }}
              >
                Code and conversation
              </SmallButton>
            </>
          ) : (
            <SmallButton
              tone="danger"
              onClick={() => {
                setAsking(null);
                onAction("restore", true);
              }}
            >
              Restore
            </SmallButton>
          )}
          <SmallButton onClick={() => setAsking(null)}>Cancel</SmallButton>
        </span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/prompt:opacity-100"
      title={disabled ?? undefined}
    >
      <ActionChip
        icon={PencilEdit02Icon}
        label="Edit & re-run"
        disabled={disabled !== null}
        onClick={() => setAsking("edit")}
      />
      <ActionChip
        icon={RotateLeft01Icon}
        label="Restore checkpoint"
        disabled={disabled !== null}
        onClick={() => setAsking("restore")}
      />
      <ActionChip
        icon={GitForkIcon}
        label="Fork from here"
        disabled={disabled !== null}
        onClick={() => onAction("fork", false)}
      />
    </div>
  );
}

function ActionChip({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof PlayIcon;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none transition-colors hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={1.9} />
      {label}
    </button>
  );
}

function SmallButton({
  children,
  tone,
  onClick,
}: {
  children: ReactNode;
  tone?: "primary" | "danger";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 text-[11.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
        tone === "primary" &&
          "bg-primary text-primary-foreground hover:opacity-90",
        tone === "danger" &&
          "bg-[color-mix(in_oklab,var(--terminal-ansi-red)_20%,transparent)] text-[var(--terminal-ansi-red)] hover:bg-[color-mix(in_oklab,var(--terminal-ansi-red)_30%,transparent)]",
        !tone &&
          "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export type RewindStatus =
  | { kind: "running"; label: string; stage: RewindStage }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string; needsTerminal: boolean };

const STAGE_TEXT: Record<RewindStage, string> = {
  opening: "Opening Claude's rewind list…",
  finding: "Finding the message…",
  choosing: "Choosing what to restore…",
  restoring: "Restoring…",
  done: "Done",
};

/** Progress, result or failure of a rewind, docked above the composer. */
export function RewindStatusBar({
  status,
  onOpenTerminal,
  onDismiss,
}: {
  status: RewindStatus;
  onOpenTerminal: () => void;
  onDismiss: () => void;
}) {
  const tone =
    status.kind === "error"
      ? "border-[color-mix(in_oklab,var(--terminal-ansi-red)_45%,transparent)] bg-[color-mix(in_oklab,var(--terminal-ansi-red)_8%,transparent)]"
      : "border-primary/35 bg-primary/[0.07]";
  return (
    <div
      role="status"
      className={cn(
        "terax-reader-in mb-2 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-[12px]",
        tone,
      )}
    >
      {status.kind === "running" && (
        <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-primary/30 border-t-primary motion-reduce:animate-none" />
      )}
      {status.kind === "done" && (
        <HugeiconsIcon
          icon={Tick02Icon}
          size={14}
          strokeWidth={2}
          className="text-agent-done"
        />
      )}
      <span className="min-w-0 flex-1 text-foreground">
        {status.kind === "running" ? (
          <>
            <span className="font-medium">{status.label}</span>
            <span className="text-muted-foreground">
              {" "}
              · {STAGE_TEXT[status.stage]}
            </span>
          </>
        ) : (
          status.message
        )}
      </span>
      {status.kind === "error" && status.needsTerminal && (
        <SmallButton tone="primary" onClick={onOpenTerminal}>
          Open terminal to finish
        </SmallButton>
      )}
      {status.kind !== "running" && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

/** A yes/no question docked above the composer (new chat). */
export function ConfirmBar({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="terax-reader-in mb-2 flex w-full flex-wrap items-center gap-2.5 rounded-xl border border-[color-mix(in_oklab,var(--agent-attention)_45%,transparent)] bg-[color-mix(in_oklab,var(--agent-attention)_8%,transparent)] px-3 py-2 text-[12px]">
      <span className="min-w-0 flex-1 text-foreground">{message}</span>
      <SmallButton tone="primary" onClick={onConfirm}>
        {confirmLabel}
      </SmallButton>
      <SmallButton onClick={onCancel}>Cancel</SmallButton>
    </div>
  );
}

/** "Context 87% full — Compact", with optional instructions for /compact. */
export function CompactBannerView({
  banner,
  onCompact,
  onDismiss,
}: {
  banner: NonNullable<CompactBanner>;
  onCompact: (instructions: string) => void;
  onDismiss: () => void;
}) {
  const [withNotes, setWithNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const high = banner.tone === "high";
  return (
    <div
      className={cn(
        "terax-reader-in mb-2 flex w-full flex-wrap items-center gap-2 rounded-xl border px-3 py-1.5 text-[12px]",
        high
          ? "border-[color-mix(in_oklab,var(--terminal-ansi-red)_45%,transparent)] bg-[color-mix(in_oklab,var(--terminal-ansi-red)_8%,transparent)]"
          : "border-[color-mix(in_oklab,var(--agent-attention)_40%,transparent)] bg-[color-mix(in_oklab,var(--agent-attention)_7%,transparent)]",
      )}
    >
      <span className="flex items-center gap-2 text-foreground">
        <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-foreground/10">
          <span
            className={cn(
              "absolute inset-y-0 left-0 rounded-full",
              high ? "bg-[var(--terminal-ansi-red)]" : "bg-agent-attention",
            )}
            style={{ width: `${Math.min(100, banner.percent)}%` }}
          />
        </span>
        <span>
          Context{" "}
          <span className="font-semibold tabular-nums">{banner.percent}%</span>{" "}
          full
        </span>
      </span>
      {withNotes ? (
        <input
          value={notes}
          // biome-ignore lint/a11y/noAutofocus: the field opens from an explicit click
          autoFocus
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              onCompact(notes);
            }
            if (e.key === "Escape") setWithNotes(false);
          }}
          placeholder="What to keep, e.g. the plan and open files"
          aria-label="Compact instructions"
          className="h-7 min-w-[12rem] flex-1 rounded-md border border-border/70 bg-background px-2 text-[12px] outline-none focus:border-primary/50"
        />
      ) : (
        <button
          type="button"
          onClick={() => setWithNotes(true)}
          className="text-[11.5px] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Add instructions
        </button>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        <SmallButton tone="primary" onClick={() => onCompact(notes)}>
          Compact
        </SmallButton>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
        </button>
      </span>
    </div>
  );
}

/** Shown while the Reader displays a past chat instead of the live session. */
export function PastChatBanner({
  title,
  onBack,
  onResume,
}: {
  title: string;
  onBack: () => void;
  onResume: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-border/60 bg-[color-mix(in_oklab,var(--primary)_9%,var(--card))] px-4 py-1.5 text-[12px]">
      <HugeiconsIcon
        icon={Clock01Icon}
        size={13}
        strokeWidth={1.9}
        className="text-primary"
      />
      <span className="min-w-0 flex-1 truncate text-foreground">
        Viewing a past chat: <span className="font-medium">{title}</span>
        <span className="text-muted-foreground"> · read only</span>
      </span>
      <SmallButton onClick={onResume}>
        <span className="flex items-center gap-1">
          <HugeiconsIcon icon={PlayIcon} size={12} strokeWidth={2} />
          Resume in new tab
        </span>
      </SmallButton>
      <SmallButton tone="primary" onClick={onBack}>
        <span className="flex items-center gap-1">
          <HugeiconsIcon icon={ArrowLeft01Icon} size={12} strokeWidth={2} />
          Back to live
        </span>
      </SmallButton>
    </div>
  );
}
