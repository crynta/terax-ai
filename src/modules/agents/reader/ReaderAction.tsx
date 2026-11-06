import { cn } from "@/lib/utils";
import type { AgentPhase } from "@/modules/terminal/lib/agentActivity";
import {
  leafScreenText,
  writeToSession,
} from "@/modules/terminal/lib/terminalSessionApi";
import {
  CheckListIcon,
  CheckmarkCircle02Icon,
  ComputerTerminal01Icon,
  File01Icon,
  FileAddIcon,
  Globe02Icon,
  HelpCircleIcon,
  PencilEdit02Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseClaudeActivity, sameActivity } from "./lib/claudeActivity";
import {
  type ClaudeDialog,
  DIALOG_TITLES,
  type DialogKind,
  type DialogOption,
  dialogKeys,
  optionTone,
  parseClaudeDialog,
  sameDialog,
} from "./lib/claudeDialog";
import { parseClaudeFooter, sameFooter } from "./lib/claudeFooter";
import { parseClaudePanel, samePanel } from "./lib/claudePanel";
import { pendingDetails } from "./lib/pendingTool";
import { useScreenStore } from "./lib/screenStore";
import type { ToolCall } from "./lib/transcript";
import { DiffView, FileChip, type ReaderContext } from "./ReaderBlocks";

/** How often the screen is read while Claude may be showing a dialog. */
const DIALOG_POLL_MS = 400;
/** How often the screen is read otherwise, for the footer (mode, status line, agents). */
const FOOTER_POLL_MS = 1_000;
/** How often the screen is read while one of Claude's panels is open, so keys feel live. */
const PANEL_POLL_MS = 150;
/** Keep reading this long after any phase change, to catch a dialog the hook hasn't flagged. */
const EDGE_MS = 6_000;
/** How long the card shows "Sent" before its buttons come back. */
const SENT_MS = 1_500;

type IconData = typeof File01Icon;

const KIND_ICON: Record<DialogKind, IconData> = {
  command: ComputerTerminal01Icon,
  edit: PencilEdit02Icon,
  create: FileAddIcon,
  read: File01Icon,
  fetch: Globe02Icon,
  plan: CheckListIcon,
  question: HelpCircleIcon,
  permission: Wrench01Icon,
};

/**
 * Reads the pane's screen while the Reader is visible: Claude Code's footer
 * every second (published to the screen store), and its dialog every 400 ms
 * while the agent needs attention or just changed phase. Returns the dialog,
 * or null when none is on screen.
 */
export function useReaderScreen(
  leafId: number,
  phase: AgentPhase | undefined,
  enabled: boolean,
): ClaudeDialog | null {
  const [dialog, setDialog] = useState<ClaudeDialog | null>(null);
  const [edgeUntil, setEdgeUntil] = useState(0);
  const lastPhase = useRef(phase);

  useEffect(() => {
    if (lastPhase.current === phase) return;
    lastPhase.current = phase;
    setEdgeUntil(Date.now() + EDGE_MS);
  }, [phase]);

  useEffect(() => {
    if (!edgeUntil) return;
    const timer = setTimeout(
      () => setEdgeUntil(0),
      Math.max(0, edgeUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [edgeUntil]);

  const dialogs = enabled && (phase === "attention" || edgeUntil > 0);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (!dialogs) setDialog(null);
  }, [dialogs]);

  useEffect(() => {
    if (!enabled) return;
    const store = useScreenStore.getState();
    const read = () => {
      if (document.hidden) return;
      const text = leafScreenText(leafId);
      const footer = text ? parseClaudeFooter(text) : null;
      const activity = text ? parseClaudeActivity(text) : null;
      const now = useScreenStore.getState();
      if (!sameFooter(now.footers[leafId] ?? null, footer)) {
        store.setFooter(leafId, footer);
      }
      if (!sameActivity(now.activities[leafId] ?? null, activity)) {
        store.setActivity(leafId, activity);
      }
      const panel = text ? parseClaudePanel(text) : null;
      if (!samePanel(now.panels[leafId] ?? null, panel)) {
        store.setPanel(leafId, panel);
      }
      setPanelOpen(panel !== null);
      if (!dialogs) return;
      const next = text ? parseClaudeDialog(text) : null;
      setDialog((current) => (sameDialog(current, next) ? current : next));
    };
    read();
    const timer = setInterval(
      read,
      panelOpen ? PANEL_POLL_MS : dialogs ? DIALOG_POLL_MS : FOOTER_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [enabled, dialogs, panelOpen, leafId]);

  // Shared so the document's Plan card answers the same dialog.
  useEffect(() => {
    useScreenStore.getState().setDialog(leafId, dialog);
  }, [leafId, dialog]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      const store = useScreenStore.getState();
      store.setFooter(leafId, null);
      store.setActivity(leafId, null);
      store.setDialog(leafId, null);
      store.setPanel(leafId, null);
    };
  }, [enabled, leafId]);

  return dialog;
}

/** Sends the keys that pick option `n`; false when the terminal can't take them. */
export function answerDialog(
  leafId: number,
  dialog: ClaudeDialog,
  n: number,
): boolean {
  const keys = dialogKeys(dialog, n);
  return keys !== null && writeToSession(leafId, keys);
}

/**
 * The "Action needed" card docked above the composer: what Claude wants to do,
 * its question, and one button per answer.
 */
export function ActionCard({
  leafId,
  dialog,
  pending,
  ctx,
  onOpenTerminal,
  onAnswered,
}: {
  leafId: number;
  dialog: ClaudeDialog;
  pending: ToolCall | null;
  ctx: ReaderContext;
  onOpenTerminal: () => void;
  /** Called after an answer is sent; `followUp` when Claude now waits for typed instructions. */
  onAnswered: (followUp: boolean) => void;
}) {
  const [sent, setSent] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  // A new question on screen brings the buttons back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the dialog identity is the trigger
  useEffect(() => {
    setSent(null);
    setFailed(false);
  }, [dialog]);
  useEffect(() => {
    if (sent === null) return;
    const timer = setTimeout(() => setSent(null), SENT_MS);
    return () => clearTimeout(timer);
  }, [sent]);

  const details = useMemo(
    () => (pending ? pendingDetails(pending) : null),
    [pending],
  );
  const title =
    dialog.kind === "permission" && dialog.header
      ? dialog.header
      : DIALOG_TITLES[dialog.kind];

  const choose = (option: DialogOption) => {
    if (sent !== null) return;
    if (!answerDialog(leafId, dialog, option.n)) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setSent(option.n);
    onAnswered(option.escape);
  };

  const escapeOption = dialog.options.find((o) => o.escape);

  return (
    <section
      aria-label="Action needed"
      className="terax-reader-action rounded-2xl border border-[color-mix(in_oklab,var(--agent-attention)_50%,transparent)] bg-[color-mix(in_oklab,var(--agent-attention)_7%,var(--card))] shadow-[0_10px_32px_-20px_rgba(0,0,0,0.8)]"
    >
      <header className="flex items-center gap-2.5 border-b border-[color-mix(in_oklab,var(--agent-attention)_25%,transparent)] px-4 py-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--agent-attention)_18%,transparent)] text-agent-attention">
          <HugeiconsIcon
            icon={KIND_ICON[dialog.kind]}
            size={15}
            strokeWidth={2}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold tracking-[0.08em] text-agent-attention uppercase">
            Action needed
          </div>
          <div className="truncate text-[13.5px] font-semibold text-foreground">
            {title}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenTerminal}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <HugeiconsIcon icon={ComputerTerminal01Icon} size={12} />
          Open terminal
        </button>
      </header>

      <div className="flex flex-col gap-3 px-4 py-3">
        <ActionDetails dialog={dialog} details={details} ctx={ctx} />
        {dialog.question && (
          <p className="text-[14px] font-medium leading-snug text-foreground">
            {dialog.question}
          </p>
        )}
        {dialog.multiSelect ? (
          <p className="text-[12.5px] text-muted-foreground">
            This question takes several answers. Pick them in the terminal.
          </p>
        ) : (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="sr-only">Answers</legend>
            {dialog.options.map((option) => (
              <OptionButton
                key={option.n}
                option={option}
                busy={sent !== null}
                sent={sent === option.n}
                onChoose={() => choose(option)}
              />
            ))}
          </fieldset>
        )}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {failed ? (
            <span className="text-[var(--terminal-ansi-red)]">
              The terminal isn't ready. Open it and answer there.
            </span>
          ) : dialog.multiSelect ? null : (
            <span>
              Press 1–{dialog.options.length} to answer
              {escapeOption
                ? ` · Esc for “${shortLabel(escapeOption.label)}”`
                : ""}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function shortLabel(label: string): string {
  const head = label.split(",")[0];
  return head.length > 28 ? `${head.slice(0, 27)}…` : head;
}

function OptionButton({
  option,
  busy,
  sent,
  onChoose,
}: {
  option: DialogOption;
  busy: boolean;
  sent: boolean;
  onChoose: () => void;
}) {
  const tone = optionTone(option);
  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={busy}
      className={cn(
        "group/opt flex w-full items-start gap-3 rounded-xl border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-default",
        tone === "primary" &&
          "border-primary/55 bg-[color-mix(in_oklab,var(--primary)_14%,transparent)] hover:bg-[color-mix(in_oklab,var(--primary)_22%,transparent)]",
        tone === "neutral" &&
          "border-border/70 bg-background/40 hover:border-border hover:bg-foreground/[0.04]",
        tone === "danger" &&
          "border-border/70 bg-background/40 hover:border-[color-mix(in_oklab,var(--terminal-ansi-red)_55%,transparent)] hover:bg-[color-mix(in_oklab,var(--terminal-ansi-red)_10%,transparent)]",
        busy && !sent && "opacity-50",
      )}
    >
      <kbd
        className={cn(
          "mt-px grid size-5 shrink-0 place-items-center rounded-md border text-[11px] font-semibold tabular-nums",
          tone === "primary"
            ? "border-primary/60 text-primary"
            : "border-border/80 text-muted-foreground",
        )}
      >
        {option.n}
      </kbd>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[13px] leading-snug",
            tone === "danger" ? "text-foreground/90" : "text-foreground",
          )}
        >
          {option.label}
        </span>
        {option.description && (
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
            {option.description}
          </span>
        )}
      </span>
      {sent && (
        <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-agent-done">
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            size={13}
            strokeWidth={2}
          />
          Sent
        </span>
      )}
      {option.selected && !sent && (
        <span className="shrink-0 self-center text-[10.5px] text-muted-foreground/80">
          selected
        </span>
      )}
    </button>
  );
}

/** What Claude is about to do: the pending call from the transcript, else the screen's lines. */
function ActionDetails({
  dialog,
  details,
  ctx,
}: {
  dialog: ClaudeDialog;
  details: ReturnType<typeof pendingDetails> | null;
  ctx: ReaderContext;
}) {
  if (
    details?.kind === "command" &&
    details.command &&
    (dialog.kind === "command" || dialog.kind === "permission")
  ) {
    return (
      <div className="flex flex-col gap-1.5">
        <pre className="terax-reader-mono max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--reader-code-bg)] px-3 py-2 text-[12.5px] leading-[1.55] text-foreground">
          <span className="select-none text-muted-foreground">$ </span>
          {details.command}
        </pre>
        {details.description && (
          <p className="text-[12px] text-muted-foreground">
            {details.description}
          </p>
        )}
      </div>
    );
  }
  if (
    details?.kind === "edit" &&
    (dialog.kind === "edit" || dialog.kind === "create")
  ) {
    return (
      <div className="flex flex-col gap-1.5">
        {details.path && (
          <div>
            <FileChip path={details.path} ctx={ctx} />
          </div>
        )}
        {details.diff.length > 0 && (
          <div className="max-h-56 overflow-hidden rounded-lg border border-border/60">
            <DiffView diff={details.diff} />
          </div>
        )}
        {details.more > 0 && (
          <p className="text-[11.5px] text-muted-foreground">
            …and {details.more} more line{details.more === 1 ? "" : "s"}
          </p>
        )}
      </div>
    );
  }
  if (
    details?.kind === "other" &&
    details.summary &&
    dialog.kind !== "question"
  ) {
    return (
      <pre className="terax-reader-mono max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--reader-code-bg)] px-3 py-2 text-[12px] leading-[1.55] text-foreground/90">
        {details.summary}
      </pre>
    );
  }
  if (dialog.details.length === 0) return null;
  return (
    <pre className="terax-reader-mono max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--reader-code-bg)] px-3 py-2 text-[12px] leading-[1.55] text-foreground/90">
      {dialog.details.join("\n")}
    </pre>
  );
}
