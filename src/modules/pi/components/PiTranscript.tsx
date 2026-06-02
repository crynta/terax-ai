import { AiChat02Icon, Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { sessionStatusDotClass } from "@/modules/pi/components/classes";
import type { PiSession, PiTranscriptItem } from "@/modules/pi/lib/sessions";

type PiTranscriptProps = {
  selectedSession: PiSession | null;
  transcript: PiTranscriptItem[];
};

function SystemRow({ item }: { item: PiTranscriptItem }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/35 bg-card/60 px-2 py-1 text-[10.5px] text-muted-foreground">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
      />
      <span className="shrink-0 font-medium text-foreground/85">
        {item.label}
      </span>
      {item.text ? (
        <span className="min-w-0 flex-1 truncate">{item.text}</span>
      ) : null}
    </div>
  );
}

function ErrorRow({ item }: { item: PiTranscriptItem }) {
  return (
    <Alert
      variant="destructive"
      className="rounded-lg border-destructive/35 px-2.5 py-2 text-[11px]"
    >
      <HugeiconsIcon icon={Alert02Icon} size={13} strokeWidth={1.85} />
      <AlertTitle className="text-[11px]">{item.label}</AlertTitle>
      {item.text ? (
        <AlertDescription className="select-text whitespace-pre-wrap text-[10.5px] leading-snug">
          {item.text}
        </AlertDescription>
      ) : null}
    </Alert>
  );
}

function UserMessage({ item }: { item: PiTranscriptItem }) {
  return (
    <Message from="user">
      <MessageContent className="text-[12px] leading-relaxed">
        {item.text ? (
          <p className="select-text whitespace-pre-wrap break-words">
            {item.text}
          </p>
        ) : null}
      </MessageContent>
    </Message>
  );
}

function AssistantMessage({ item }: { item: PiTranscriptItem }) {
  return (
    <Message from="assistant" className="gap-1">
      <MessageContent className="w-full text-[12px] leading-relaxed">
        <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground">
          <HugeiconsIcon icon={AiChat02Icon} size={11} strokeWidth={1.8} />
          <span>Pi</span>
        </div>
        {item.text ? (
          <p className="select-text whitespace-pre-wrap break-words text-foreground">
            {item.text}
          </p>
        ) : null}
      </MessageContent>
    </Message>
  );
}

function TranscriptItem({ item }: { item: PiTranscriptItem }) {
  switch (item.kind) {
    case "assistant":
      return <AssistantMessage item={item} />;
    case "user":
      return <UserMessage item={item} />;
    case "error":
      return <ErrorRow item={item} />;
    case "system":
      return <SystemRow item={item} />;
  }
}

export function PiTranscript({
  selectedSession,
  transcript,
}: PiTranscriptProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 py-2">
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/40 bg-background/70">
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border/35 px-2">
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              selectedSession
                ? sessionStatusDotClass(selectedSession.status)
                : "bg-muted-foreground/35",
            )}
          />
          <span className="truncate text-[11px] font-medium text-foreground">
            {selectedSession?.title ?? "Session"}
          </span>
          <span className="ml-auto text-[10px] capitalize text-muted-foreground">
            {selectedSession?.status ?? "idle"}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {transcript.length === 0 ? (
            <Empty className="h-full min-h-40 gap-2 rounded-none border-0 p-4">
              <EmptyHeader className="gap-1.5">
                <EmptyMedia
                  variant="icon"
                  className="size-9 rounded-xl text-muted-foreground"
                >
                  <HugeiconsIcon
                    icon={AiChat02Icon}
                    size={16}
                    strokeWidth={1.75}
                  />
                </EmptyMedia>
                <EmptyTitle className="text-[12px] tracking-normal">
                  No messages yet
                </EmptyTitle>
                <EmptyDescription className="max-w-52 text-[10.5px] leading-snug">
                  Send a prompt to start the transcript.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {transcript.map((item) => (
                <TranscriptItem key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
