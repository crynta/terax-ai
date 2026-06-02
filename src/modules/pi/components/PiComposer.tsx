import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PiSession } from "@/modules/pi/lib/sessions";

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

function composerHint(
  runtimeReady: boolean,
  selectedSession: PiSession | null,
): string {
  if (!runtimeReady) return "Start Pi to send prompts.";
  if (selectedSession === null) return "Create or select a session.";
  return "Enter to send, Shift Enter for a new line.";
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
  const sendDisabled = disabled || prompt.trim() === "";
  const stopDisabled =
    !runtimeReady ||
    selectedSession === null ||
    selectedSession.status === "stopped" ||
    isBusy;

  return (
    <form
      className="shrink-0 border-t border-border/35 bg-card/40 px-2.5 py-2"
      onSubmit={onSendPrompt}
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
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="h-6"
          disabled={stopDisabled}
          onClick={onStopSession}
        >
          Stop
        </Button>
        <Button
          type="submit"
          size="xs"
          className="h-6 min-w-16"
          disabled={sendDisabled}
        >
          Send
        </Button>
      </div>
    </form>
  );
}
