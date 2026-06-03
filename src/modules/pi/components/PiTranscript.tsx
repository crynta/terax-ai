import {
  AiChat02Icon,
  Alert02Icon,
  CheckmarkCircle01Icon,
  Copy01Icon,
  File01Icon,
  Folder01Icon,
  IncognitoIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { sessionStatusDotClass } from "@/modules/pi/components/classes";
import type {
  PiPromptContext,
  PiSession,
  PiTranscriptItem,
} from "@/modules/pi/lib/sessions";
import { pathBasename } from "@/modules/pi/lib/view";

type PiTranscriptProps = {
  selectedSession: PiSession | null;
  transcript: PiTranscriptItem[];
  onUsePrompt?: (prompt: string) => void;
};

const PROMPT_SUGGESTIONS = [
  "Explain this project",
  "Summarize current file",
  "Find where auth is configured",
];

type PromptContextChip = {
  label: string;
  value?: string;
  title?: string;
  tone?: "default" | "private";
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
};

function contextValue(path: string): string {
  return pathBasename(path) ?? path;
}

function promptContextChips(
  context: PiPromptContext | null | undefined,
): PromptContextChip[] {
  if (!context) return [];

  const chips: PromptContextChip[] = [];
  if (context.workspaceRoot) {
    chips.push({
      label: "Workspace",
      value: contextValue(context.workspaceRoot),
      title: context.workspaceRoot,
      icon: Folder01Icon,
    });
  }
  if (context.activeTerminalCwd) {
    chips.push({
      label: "Terminal",
      value: contextValue(context.activeTerminalCwd),
      title: context.activeTerminalCwd,
      icon: TerminalIcon,
    });
  }
  if (context.activeFile) {
    chips.push({
      label: "File",
      value: contextValue(context.activeFile),
      title: context.activeFile,
      icon: File01Icon,
    });
  }
  if (context.activeTerminalPrivate) {
    chips.push({
      label: "Private terminal",
      tone: "private",
      icon: IncognitoIcon,
    });
  }
  return chips;
}

function PromptContextChips({
  context,
}: {
  context: PiPromptContext | null | undefined;
}) {
  const chips = promptContextChips(context);
  if (chips.length === 0) return null;

  return (
    <div className="mb-1 flex max-w-full flex-wrap justify-end gap-1">
      <span className="inline-flex items-center rounded-md border border-border/45 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        Context sent
      </span>
      {chips.map((chip) => (
        <span
          key={`${chip.label}-${chip.value ?? "on"}`}
          title={chip.title}
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-md border border-border/45 bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground",
            chip.tone === "private" && "bg-muted/60 text-muted-foreground/90",
          )}
        >
          <HugeiconsIcon
            icon={chip.icon}
            size={10}
            strokeWidth={1.75}
            className="shrink-0"
          />
          <span className="shrink-0 font-medium text-foreground/85">
            {chip.label}
          </span>
          {chip.value ? (
            <span className="min-w-0 truncate">{chip.value}</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function CopyMessageAction({
  label,
  text,
}: {
  label: string;
  text: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  if (!text) return null;

  const onCopy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can fail in tests or restricted webviews.
    }
  };

  return (
    <MessageActions className="opacity-70 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
      <MessageAction
        aria-label={label}
        label={label}
        tooltip={copied ? "Copied" : label}
        size="icon-xs"
        variant="ghost"
        className="size-5 text-muted-foreground hover:text-foreground"
        onClick={() => void onCopy()}
      >
        <HugeiconsIcon
          icon={copied ? CheckmarkCircle01Icon : Copy01Icon}
          size={11}
          strokeWidth={1.8}
        />
      </MessageAction>
    </MessageActions>
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
    <Message from="user" className="gap-1">
      <MessageContent className="text-[12px] leading-relaxed">
        <PromptContextChips context={item.context} />
        {item.text ? (
          <p className="select-text whitespace-pre-wrap break-words">
            {item.text}
          </p>
        ) : null}
      </MessageContent>
      <CopyMessageAction label="Copy prompt" text={item.text} />
    </Message>
  );
}

function AssistantMessage({
  item,
  streaming,
}: {
  item: PiTranscriptItem;
  streaming: boolean;
}) {
  return (
    <Message from="assistant" className="gap-1">
      <MessageContent className="w-full text-[12px] leading-relaxed">
        <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground">
          <HugeiconsIcon icon={AiChat02Icon} size={11} strokeWidth={1.8} />
          <span>Pi</span>
          {streaming ? (
            <span className="size-1.5 animate-pulse rounded-full bg-primary/70" />
          ) : null}
        </div>
        {item.text ? (
          <MessageResponse
            streaming={streaming}
            className="select-text prose-sm max-w-full break-words text-[12px] leading-relaxed text-foreground [&_p]:break-words"
          >
            {item.text}
          </MessageResponse>
        ) : null}
      </MessageContent>
      <CopyMessageAction label="Copy response" text={item.text} />
    </Message>
  );
}

function ThinkingRow() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/35 bg-card/60 px-2.5 py-2 text-[11px] text-muted-foreground">
      <span className="size-1.5 animate-pulse rounded-full bg-primary/70" />
      <HugeiconsIcon icon={AiChat02Icon} size={12} strokeWidth={1.8} />
      <span className="truncate">Pi is thinking…</span>
    </div>
  );
}

function unreachableTranscriptKind(kind: never): null {
  void kind;
  return null;
}

function TranscriptItem({
  item,
  streaming,
}: {
  item: PiTranscriptItem;
  streaming: boolean;
}) {
  switch (item.kind) {
    case "assistant":
      return <AssistantMessage item={item} streaming={streaming} />;
    case "user":
      return <UserMessage item={item} />;
    case "error":
      return <ErrorRow item={item} />;
    case "system":
      return null;
    default:
      return unreachableTranscriptKind(item.kind);
  }
}

function EmptyTranscript({
  onUsePrompt,
}: {
  onUsePrompt?: (prompt: string) => void;
}) {
  return (
    <Empty className="h-full min-h-40 gap-2 rounded-none border-0 p-4">
      <EmptyHeader className="gap-1.5">
        <EmptyMedia
          variant="icon"
          className="size-9 rounded-xl text-muted-foreground"
        >
          <HugeiconsIcon icon={AiChat02Icon} size={16} strokeWidth={1.75} />
        </EmptyMedia>
        <EmptyTitle className="text-[12px] tracking-normal">
          No messages yet
        </EmptyTitle>
        <EmptyDescription className="max-w-56 text-[10.5px] leading-snug">
          Send a prompt or start from one of these workspace questions.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-56 gap-1.5">
        {PROMPT_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="w-full truncate rounded-md border border-border/40 bg-card/60 px-2 py-1 text-left text-[10.5px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-70"
            disabled={!onUsePrompt}
            onClick={() => onUsePrompt?.(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </EmptyContent>
    </Empty>
  );
}

export function PiTranscript({
  selectedSession,
  transcript,
  onUsePrompt,
}: PiTranscriptProps) {
  const visibleTranscript = useMemo(
    () => transcript.filter((item) => item.kind !== "system"),
    [transcript],
  );
  const isRunning = selectedSession?.status === "running";
  const lastVisible = visibleTranscript[visibleTranscript.length - 1] ?? null;
  const streamingAssistantId =
    isRunning && lastVisible?.kind === "assistant" ? lastVisible.id : null;
  const showThinking = isRunning && lastVisible?.kind !== "assistant";
  const hasVisibleTranscript = visibleTranscript.length > 0;

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
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="min-h-full gap-3 p-2">
            {!hasVisibleTranscript && !showThinking ? (
              <EmptyTranscript onUsePrompt={onUsePrompt} />
            ) : (
              <>
                {visibleTranscript.map((item) => (
                  <TranscriptItem
                    key={item.id}
                    item={item}
                    streaming={item.id === streamingAssistantId}
                  />
                ))}
                {showThinking ? <ThinkingRow /> : null}
              </>
            )}
          </ConversationContent>
          <ConversationScrollButton className="bottom-2 size-6" />
        </Conversation>
      </div>
    </div>
  );
}
