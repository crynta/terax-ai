import { ArrowUpIcon, StopCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MAX_PI_PROMPT_CHARS, type PiSession } from "@/modules/pi/lib/sessions";

type PiComposerProps = {
  disabled: boolean;
  isBusy: boolean;
  prompt: string;
  runtimeReady: boolean;
  selectedSession: PiSession | null;
  onPromptChange: (prompt: string) => void;
  onSendPrompt: (event: FormEvent<HTMLFormElement>) => void;
  onStopSession: () => void;
};

const PROMPT_LIMIT_WARNING_CHARS = 19_000;

function composerHint(
  runtimeReady: boolean,
  selectedSession: PiSession | null,
): string {
  if (!runtimeReady) return "Start Pi to send prompts.";
  if (selectedSession === null) return "Create or select a session.";
  if (selectedSession.status === "running") {
    return "Pi is responding. Stop it before sending another prompt.";
  }
  if (selectedSession.status === "stopped") {
    return "Create a new session to send more prompts.";
  }
  if (selectedSession.status === "error") {
    return "Fix settings if needed, then send again to retry.";
  }
  return "Enter to send · Shift Enter for newline";
}

function promptLimitLabel(prompt: string): string | null {
  if (prompt.length < PROMPT_LIMIT_WARNING_CHARS) return null;
  return `${prompt.length.toLocaleString()}/${MAX_PI_PROMPT_CHARS.toLocaleString()}`;
}

export function PiComposer({
  disabled,
  isBusy,
  prompt,
  runtimeReady,
  selectedSession,
  onPromptChange,
  onSendPrompt,
  onStopSession,
}: PiComposerProps) {
  const isRunning = selectedSession?.status === "running";
  const sendDisabled =
    disabled || prompt.trim() === "" || prompt.length > MAX_PI_PROMPT_CHARS;
  const stopDisabled =
    !runtimeReady || selectedSession === null || !isRunning || isBusy;
  const limitLabel = promptLimitLabel(prompt);
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
        className="min-h-16 rounded-lg border-border/45 bg-background/95 px-2.5 py-2 text-[12px] leading-relaxed shadow-sm placeholder:text-muted-foreground/60 focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/15 disabled:bg-muted/35"
        value={prompt}
        placeholder="Ask Pi about this workspace"
        disabled={disabled}
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
          {composerHint(runtimeReady, selectedSession)}
        </span>
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
        {isRunning ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-6 min-w-16"
            aria-label="Stop response"
            disabled={stopDisabled}
            onClick={onStopSession}
          >
            <HugeiconsIcon
              data-icon="inline-start"
              icon={StopCircleIcon}
              size={11}
              strokeWidth={1.75}
            />
            Stop
          </Button>
        ) : (
          <Button
            type="submit"
            size="xs"
            className="h-6 min-w-16"
            aria-label="Send prompt"
            disabled={sendDisabled}
          >
            Send
            <HugeiconsIcon
              data-icon="inline-end"
              icon={ArrowUpIcon}
              size={11}
              strokeWidth={1.75}
            />
          </Button>
        )}
      </div>
    </form>
  );
}
