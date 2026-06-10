import ArrowUpIcon from "@hugeicons/core-free-icons/ArrowUp01Icon";
import StopCircleIcon from "@hugeicons/core-free-icons/StopCircleIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { PiComposerContextUsage } from "@/modules/pi/lib/panel-state";
import type { PiThinkingLevel } from "@/modules/pi/lib/provider";
import { MAX_PI_PROMPT_CHARS, type PiSession } from "@/modules/pi/lib/sessions";

type PiComposerStatus =
  | { phase: "offline" }
  | { phase: "busy" }
  | { phase: "active"; canCreateSession: boolean };

type PiComposerProps = {
  availableThinkingLevels: PiThinkingLevel[];
  contextUsage: PiComposerContextUsage | null;
  prompt: string;
  selectedSession: PiSession | null;
  status: PiComposerStatus;
  thinkingLevel: PiThinkingLevel | null;
  onCreateSession: () => void;
  onPromptChange: (prompt: string) => void;
  onRetryLastPrompt: () => void;
  onSendPrompt: (event: FormEvent<HTMLFormElement>) => void;
  onStopSession: () => void;
  onThinkingLevelChange: (level: PiThinkingLevel) => void;
};

const PROMPT_LIMIT_WARNING_CHARS = 19_000;

function composerHint(
  runtimeReady: boolean,
  selectedSession: PiSession | null,
  prompt: string,
): string {
  if (!runtimeReady) return "Start Pi to send prompts.";
  if (selectedSession === null) return "Create or select a session.";
  if (selectedSession.status === "running") {
    return "Pi is responding. Stop it before sending another prompt.";
  }
  if (selectedSession.status === "stopped") {
    return "This session is stopped. Create a new session to continue.";
  }
  if (selectedSession.status === "error") {
    return "Pi hit an error. Retry the last prompt or adjust it below.";
  }
  if (prompt.length > MAX_PI_PROMPT_CHARS) {
    return `Prompt is over ${MAX_PI_PROMPT_CHARS.toLocaleString()} characters.`;
  }
  return "Enter to send · Shift Enter for newline";
}

function promptLimitLabel(prompt: string): string | null {
  if (prompt.length < PROMPT_LIMIT_WARNING_CHARS) return null;
  return `${prompt.length.toLocaleString()}/${MAX_PI_PROMPT_CHARS.toLocaleString()}`;
}

function contextUsageLabel(
  usage: PiComposerContextUsage | null,
): string | null {
  if (usage === null || usage.tokens === null) return null;
  const tokenLabel = usage.tokens.toLocaleString();
  const windowLabel = usage.contextWindow?.toLocaleString() ?? "unknown";
  const percentLabel =
    usage.percent === null
      ? null
      : `${usage.tokens === 0 ? 0 : Math.max(1, Math.round(usage.percent))}%`;
  return percentLabel === null
    ? `Context ${tokenLabel} / ${windowLabel}`
    : `Context ${tokenLabel} / ${windowLabel} ${percentLabel}`;
}

function thinkingLevelLabel(level: PiThinkingLevel): string {
  if (level === "xhigh") return "X high";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function PiComposer({
  availableThinkingLevels,
  contextUsage,
  prompt,
  selectedSession,
  status,
  thinkingLevel,
  onCreateSession,
  onPromptChange,
  onRetryLastPrompt,
  onSendPrompt,
  onStopSession,
  onThinkingLevelChange,
}: PiComposerProps) {
  const isActive = status.phase === "active";
  const isRunning = selectedSession?.status === "running";
  const isStopped = selectedSession?.status === "stopped";
  const thinkingDisabled = !isActive || isRunning;
  const thinkingTitle = isRunning
    ? "Locked during run"
    : status.phase === "busy"
      ? "Wait for current action"
      : "Applies to next reply";
  const canRetryLastPrompt =
    isActive &&
    selectedSession?.status === "error" &&
    typeof selectedSession.lastPrompt === "string" &&
    selectedSession.lastPrompt.trim() !== "";
  const textareaDisabled = !isActive;
  const sendDisabled =
    textareaDisabled ||
    prompt.trim() === "" ||
    prompt.length > MAX_PI_PROMPT_CHARS;
  const stopDisabled = !isActive || selectedSession === null || !isRunning;
  const canCreateSession = status.phase === "active" && status.canCreateSession;
  const limitLabel = promptLimitLabel(prompt);
  const usageLabel = contextUsageLabel(contextUsage);
  const overLimit = prompt.length > MAX_PI_PROMPT_CHARS;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (sendDisabled) {
      event.preventDefault();
      return;
    }
    onSendPrompt(event);
  };

  return (
    <form
      className="shrink-0 border-t border-border/35 bg-card/40 px-2.5 py-2"
      onSubmit={onSubmit}
    >
      <Textarea
        aria-label="Pi prompt"
        className="max-h-32 min-h-16 overflow-y-auto overscroll-contain rounded-lg border-border/45 bg-background/95 px-2.5 py-2 text-[12px] leading-relaxed shadow-sm placeholder:text-muted-foreground focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/15 disabled:bg-muted/35"
        value={prompt}
        placeholder="Ask Pi about this workspace"
        disabled={textareaDisabled}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/70">
          {status.phase === "offline"
            ? "Start Pi to send prompts."
            : composerHint(true, selectedSession, prompt)}
        </span>
        {availableThinkingLevels.length > 0 && thinkingLevel ? (
          <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/70">
            <span>Thinking</span>
            <select
              aria-label="Pi thinking level for next reply"
              className="h-6 min-w-20 rounded-md border border-border/45 bg-background px-1.5 text-[10px] capitalize text-foreground outline-none transition-[color,box-shadow,border-color] focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={thinkingDisabled}
              title={thinkingTitle}
              value={thinkingLevel}
              onChange={(event) =>
                onThinkingLevelChange(
                  event.currentTarget.value as PiThinkingLevel,
                )
              }
            >
              {availableThinkingLevels.map((level) => (
                <option key={level} value={level}>
                  {thinkingLevelLabel(level)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {usageLabel ? (
          <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/70">
            {usageLabel}
          </span>
        ) : null}
        {limitLabel ? (
          <span
            className={cn(
              "shrink-0 tabular-nums text-[10px] text-muted-foreground/70",
              overLimit && "text-destructive",
            )}
          >
            {limitLabel}
          </span>
        ) : null}
        {isStopped ? (
          <Button
            type="button"
            size="xs"
            variant="secondary"
            className="h-6 min-w-20 rounded-md text-[10.5px]"
            aria-label="Create new Pi session"
            disabled={!canCreateSession}
            onClick={onCreateSession}
          >
            New session
          </Button>
        ) : canRetryLastPrompt && prompt.trim() === "" ? (
          <Button
            type="button"
            size="xs"
            variant="secondary"
            className="h-6 min-w-20 rounded-md text-[10.5px]"
            aria-label="Retry last Pi prompt"
            onClick={onRetryLastPrompt}
          >
            Retry last
          </Button>
        ) : isRunning ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-6 min-w-16 rounded-md text-[10.5px]"
            aria-label="Stop response"
            disabled={stopDisabled}
            onClick={onStopSession}
          >
            <HugeiconsIcon
              data-icon="inline-start"
              icon={StopCircleIcon}
              strokeWidth={1.75}
            />
            Stop
          </Button>
        ) : (
          <Button
            type="submit"
            size="xs"
            className="h-6 min-w-16 rounded-md text-[10.5px]"
            aria-label="Send prompt"
            disabled={sendDisabled}
          >
            Send
            <HugeiconsIcon
              data-icon="inline-end"
              icon={ArrowUpIcon}
              strokeWidth={1.75}
            />
          </Button>
        )}
      </div>
    </form>
  );
}
