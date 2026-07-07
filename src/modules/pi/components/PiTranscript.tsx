import AiChat02Icon from "@hugeicons/core-free-icons/AiChat02Icon";
import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowReloadHorizontalIcon from "@hugeicons/core-free-icons/ArrowReloadHorizontalIcon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import CheckmarkCircle01Icon from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import FullscreenIcon from "@hugeicons/core-free-icons/FullscreenIcon";
import IncognitoIcon from "@hugeicons/core-free-icons/IncognitoIcon";
import Speaker01Icon from "@hugeicons/core-free-icons/Speaker01Icon";
import StopCircleIcon from "@hugeicons/core-free-icons/StopCircleIcon";
import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";
import ToolsIcon from "@hugeicons/core-free-icons/ToolsIcon";
import WindowsNewIcon from "@hugeicons/core-free-icons/WindowsNewIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useEffect, useMemo, useState } from "react";
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
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Tool } from "@/components/ai-elements/tool";
import { LazyRow } from "@/components/lazy-row";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { isTtsReadAloudEnabled } from "@/modules/ai/lib/featureGates";
import { sessionStatusDotClass } from "@/modules/pi/components/classes";
import type {
  PiPromptContext,
  PiQuestionAnswer,
  PiSession,
  PiTranscriptItem,
} from "@/modules/pi/lib/sessions";
import {
  copyStatusLabel,
  useCopyToClipboard,
} from "@/modules/pi/lib/useCopyToClipboard";
import { pathBasename } from "@/modules/pi/lib/view";
import { useTts } from "@/modules/pi/lib/useTts";

type PiRegenerateRequest = {
  branchGroupId: string;
  prompt: string;
  context?: PiPromptContext;
};

type PiTranscriptProps = {
  selectedSession: PiSession | null;
  transcript: PiTranscriptItem[];
  canRegenerate?: boolean;
  onOpenWorkspace?: () => void;
  onPopOut?: () => void;
  onRegenerate?: (request: PiRegenerateRequest) => void;
  onForkFromTurn?: (eventId: string) => void;
  onRollbackToTurn?: (eventId: string) => void;
  onToolApproval?: (toolCallId: string, approved: boolean) => void;
  onQuestionRespond?: (questionId: string, answers: PiQuestionAnswer[]) => void;
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
  const { copyText, status } = useCopyToClipboard();
  if (!text) return null;

  const statusLabel = copyStatusLabel(status);

  return (
    <MessageActions className="opacity-70 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
      <MessageAction
        aria-label={status === "failed" ? `${label}: Copy failed` : label}
        data-copy-failure-label="Copy failed"
        label={label}
        tooltip={statusLabel || label}
        size="icon-xs"
        variant="ghost"
        className={cn(
          "size-5 text-muted-foreground hover:text-foreground",
          status === "failed" && "text-destructive hover:text-destructive",
        )}
        onClick={() => void copyText(text)}
      >
        <HugeiconsIcon
          icon={
            status === "copied"
              ? CheckmarkCircle01Icon
              : status === "failed"
                ? Alert02Icon
                : Copy01Icon
          }
          size={11}
          strokeWidth={1.8}
        />
        <span aria-live="polite" className="sr-only" role="status">
          {statusLabel}
        </span>
      </MessageAction>
    </MessageActions>
  );
}

function TtsMessageAction({
  speaking,
  onSpeak,
  onStop,
}: {
  speaking: boolean;
  onSpeak: () => void;
  onStop: () => void;
}) {
  return (
    <MessageActions className="opacity-70 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
      <MessageAction
        aria-label={speaking ? "Stop reading aloud" : "Read aloud"}
        label="Read aloud"
        tooltip={speaking ? "Stop" : "Read aloud"}
        size="icon-xs"
        variant="ghost"
        className="size-5 text-muted-foreground hover:text-foreground"
        onClick={speaking ? onStop : onSpeak}
      >
        <HugeiconsIcon
          icon={speaking ? StopCircleIcon : Speaker01Icon}
          size={11}
          strokeWidth={1.8}
        />
      </MessageAction>
    </MessageActions>
  );
}

const PI_TOOL_UI_NAMES: Record<string, string> = {
  bash: "bash_run",
  edit: "multi_edit",
  find: "glob",
  grep: "grep",
  ls: "list_directory",
  read: "read_file",
  write: "write_file",
  create_artifact: "create_artifact",
  edit_artifact: "edit_artifact",
  read_artifact: "read_artifact",
  list_artifacts: "list_artifacts",
};

const PI_TOOL_LABELS: Record<string, string> = {
  bash: "Run shell command",
  edit: "Edit file",
  find: "Find files",
  grep: "Search files",
  ls: "List directory",
  read: "Read file",
  write: "Write file",
  create_artifact: "Create artifact",
  edit_artifact: "Edit artifact",
  read_artifact: "Read artifact",
  list_artifacts: "List artifacts",
};

function mappedToolName(toolName: string | undefined): string {
  if (!toolName) return "tool";
  return PI_TOOL_UI_NAMES[toolName] ?? toolName;
}

function toolOutputForDisplay(item: PiTranscriptItem): unknown {
  const output = item.toolOutput;
  if (!output) return undefined;
  if (output.details !== null && output.content) {
    return output;
  }
  return output.content || output.details || undefined;
}

function toolInputRecord(item: PiTranscriptItem): Record<string, unknown> {
  return item.toolInput &&
    typeof item.toolInput === "object" &&
    !Array.isArray(item.toolInput)
    ? (item.toolInput as Record<string, unknown>)
    : {};
}

function toolInputString(
  input: Record<string, unknown>,
  key: string,
): string | null {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toolApprovalSummary(item: PiTranscriptItem): string {
  const input = toolInputRecord(item);
  switch (item.toolName) {
    case "bash":
      return toolInputString(input, "command") ?? "Shell command";
    case "edit": {
      const edits = Array.isArray(input.edits) ? input.edits.length : 0;
      return `${toolInputString(input, "path") ?? "File"} · ${edits} edit${edits === 1 ? "" : "s"}`;
    }
    case "write": {
      const content = toolInputString(input, "content") ?? "";
      const lines = content ? content.split("\n").length : 0;
      return `${toolInputString(input, "path") ?? "File"} · ${lines} line${lines === 1 ? "" : "s"}`;
    }
    case "find":
      return toolInputString(input, "pattern") ?? "File pattern";
    case "grep":
      return toolInputString(input, "pattern") ?? "Search pattern";
    case "ls":
    case "read":
      return toolInputString(input, "path") ?? ".";
    default:
      return item.toolName ?? "Tool";
  }
}

function ToolApprovalPanel({
  item,
  onToolApproval,
}: {
  item: PiTranscriptItem;
  onToolApproval?: (toolCallId: string, approved: boolean) => void;
}) {
  const toolCallId = item.toolCallId;
  if (item.toolState !== "approval-requested" || !toolCallId) {
    return null;
  }

  const input = toolInputRecord(item);
  const command =
    item.toolName === "bash" ? toolInputString(input, "command") : null;

  return (
    <div className="mx-2 mb-2 rounded-md border border-border/60 bg-foreground/[0.04] px-2 py-2">
      <div className="flex items-start gap-2">
        <HugeiconsIcon
          icon={item.toolName === "bash" ? TerminalIcon : ToolsIcon}
          size={13}
          strokeWidth={1.8}
          className="mt-0.5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium text-foreground">
            {PI_TOOL_LABELS[item.toolName ?? ""] ?? "Tool"} needs approval
          </div>
          {command ? (
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-1.5 font-mono text-[10.5px] leading-snug text-foreground">
              {command}
            </pre>
          ) : (
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
              {toolApprovalSummary(item)}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="h-6 px-2 text-[10.5px]"
          disabled={!onToolApproval}
          onClick={() => onToolApproval?.(toolCallId, false)}
        >
          Deny
        </Button>
        <Button
          type="button"
          size="xs"
          className="h-6 px-2 text-[10.5px]"
          disabled={!onToolApproval}
          onClick={() => onToolApproval?.(toolCallId, true)}
        >
          Approve
        </Button>
      </div>
    </div>
  );
}

function formatQuestionAnswerLabels(answers: PiQuestionAnswer[]): string {
  if (answers.length === 0) return "No answer";
  return answers
    .map((answer) =>
      answer.customText
        ? `${answer.label}: ${answer.customText}`
        : answer.label,
    )
    .join(", ");
}

function QuestionMessage({
  item,
  onQuestionRespond,
}: {
  item: PiTranscriptItem;
  onQuestionRespond?: (questionId: string, answers: PiQuestionAnswer[]) => void;
}) {
  const questionId = item.questionId;
  const options = item.questionOptions ?? [];
  const allowMultiple = item.questionAllowMultiple === true;
  const answered = item.questionState === "answered";
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  if (!questionId) return null;

  const respond = (labels: string[]) => {
    if (submitting) return; // guard against double-submit before the answer round-trips
    setSubmitting(true);
    onQuestionRespond?.(
      questionId,
      labels.map((label) => ({ label })),
    );
  };
  const disabled = !onQuestionRespond || submitting;

  return (
    <div className="mx-2 mb-2 rounded-md border border-border/60 bg-foreground/[0.04] px-2 py-2">
      <div className="flex items-start gap-2">
        <HugeiconsIcon
          icon={AiChat02Icon}
          size={13}
          strokeWidth={1.8}
          className="mt-0.5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1 text-[11px] font-medium text-foreground">
          {item.text ?? "The agent has a question"}
        </div>
      </div>

      {answered ? (
        <div className="mt-1.5 pl-5 text-[10.5px] text-muted-foreground">
          Answered: {formatQuestionAnswerLabels(item.questionAnswers ?? [])}
        </div>
      ) : (
        <div className="mt-2 pl-5">
          <div className="flex flex-wrap gap-1.5">
            {options.map((option) => {
              const isSelected = selected.includes(option.label);
              return (
                <Button
                  key={option.label}
                  type="button"
                  size="xs"
                  variant={allowMultiple && isSelected ? "default" : "outline"}
                  className="h-6 px-2 text-[10.5px]"
                  aria-pressed={allowMultiple ? isSelected : undefined}
                  disabled={disabled}
                  title={option.description}
                  onClick={() => {
                    if (allowMultiple) {
                      setSelected((current) =>
                        isSelected
                          ? current.filter((label) => label !== option.label)
                          : [...current, option.label],
                      );
                    } else {
                      respond([option.label]);
                    }
                  }}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
          {allowMultiple ? (
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                size="xs"
                className="h-6 px-2 text-[10.5px]"
                disabled={disabled || selected.length === 0}
                onClick={() => respond(selected)}
              >
                Submit
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ToolMessage({
  item,
  onToolApproval,
}: {
  item: PiTranscriptItem;
  onToolApproval?: (toolCallId: string, approved: boolean) => void;
}) {
  const state = item.toolState ?? "input-available";
  const errorText =
    item.toolState === "output-denied"
      ? "Denied by user."
      : (item.toolErrorText ?? undefined);

  return (
    <div className="rounded-lg border border-border/35 bg-card/45 py-1">
      <Tool
        defaultOpen={state === "approval-requested" || state === "output-error"}
        errorText={errorText}
        input={item.toolInput}
        output={toolOutputForDisplay(item)}
        state={state}
        toolName={mappedToolName(item.toolName)}
      />
      <ToolApprovalPanel item={item} onToolApproval={onToolApproval} />
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

function BranchControls({
  current,
  total,
  onNext,
  onPrevious,
}: {
  current: number;
  total: number;
  onNext: () => void;
  onPrevious: () => void;
}) {
  if (total <= 1) return null;

  return (
    <ButtonGroup
      aria-label="Response branches"
      className="ml-auto [&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md"
      orientation="horizontal"
    >
      <Button
        aria-label="Previous branch"
        className="size-5 text-muted-foreground hover:text-foreground"
        size="icon-xs"
        type="button"
        variant="ghost"
        onClick={onPrevious}
      >
        <HugeiconsIcon
          data-icon="inline-start"
          icon={ArrowLeft01Icon}
          strokeWidth={1.8}
        />
      </Button>
      <ButtonGroupText className="h-5 border-none bg-transparent px-1 text-[10px] text-muted-foreground shadow-none">
        Version {current + 1} of {total}
      </ButtonGroupText>
      <Button
        aria-label="Next branch"
        className="size-5 text-muted-foreground hover:text-foreground"
        size="icon-xs"
        type="button"
        variant="ghost"
        onClick={onNext}
      >
        <HugeiconsIcon
          data-icon="inline-start"
          icon={ArrowRight01Icon}
          strokeWidth={1.8}
        />
      </Button>
    </ButtonGroup>
  );
}

function RegenerateMessageAction({
  canRegenerate,
  item,
  onRegenerate,
}: {
  canRegenerate: boolean;
  item: PiTranscriptItem;
  onRegenerate?: (request: PiRegenerateRequest) => void;
}) {
  if (!item.branchGroupId || !item.promptText || !onRegenerate) return null;

  return (
    <MessageActions className="opacity-100">
      <MessageAction
        aria-label="Regenerate response"
        disabled={!canRegenerate}
        label="Regenerate response"
        tooltip={
          canRegenerate
            ? "Regenerate response"
            : "Wait for Pi to finish before regenerating"
        }
        size="xs"
        variant="ghost"
        className="h-5 rounded-md px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
        onClick={() =>
          onRegenerate({
            branchGroupId: item.branchGroupId as string,
            prompt: item.promptText as string,
            context: item.promptContext,
          })
        }
      >
        <HugeiconsIcon
          icon={ArrowReloadHorizontalIcon}
          size={11}
          strokeWidth={1.8}
        />
        <span aria-hidden>Regenerate</span>
      </MessageAction>
    </MessageActions>
  );
}

function AssistantMessage({
  canRegenerate,
  item,
  onRegenerate,
  streaming,
  ttsSpeaking,
  ttsActiveMessageId,
  onTtsSpeak,
  onTtsStop,
}: {
  canRegenerate: boolean;
  item: PiTranscriptItem;
  onRegenerate?: (request: PiRegenerateRequest) => void;
  streaming: boolean;
  ttsSpeaking: boolean;
  ttsActiveMessageId: string | null;
  onTtsSpeak: (text: string, messageId: string) => void;
  onTtsStop: () => void;
}) {
  const branches = item.branches?.length ? item.branches : null;
  const defaultBranch = branches ? branches.length - 1 : 0;
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);

  useEffect(() => {
    setCurrentBranch(defaultBranch);
    // Reset to the default branch when switching items, even if defaultBranch
    // happens to match the previous item's value.
    // biome-ignore lint/correctness/useExhaustiveDependencies: item.id intentionally resets branch
  }, [defaultBranch, item.id]);

  const activeBranch = branches?.[currentBranch] ?? null;
  const responseText = activeBranch?.text ?? item.text;
  const reasoningText = activeBranch?.reasoningText ?? item.reasoningText;
  const reasoningStreaming =
    streaming && Boolean(reasoningText) && !responseText;

  const ttsDisabled = !isTtsReadAloudEnabled() || streaming || !responseText;
  const isTtsSpeakingThis = ttsSpeaking && ttsActiveMessageId === item.id;

  return (
    <Message from="assistant" className="gap-1">
      <MessageContent className="w-full text-[12px] leading-relaxed">
        <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground">
          <HugeiconsIcon icon={AiChat02Icon} size={11} strokeWidth={1.8} />
          <span>Pi</span>
          {streaming ? (
            <span className="size-1.5 animate-pulse rounded-full bg-foreground/70" />
          ) : null}
        </div>
        {reasoningText ? (
          <Reasoning
            defaultOpen={reasoningStreaming}
            isStreaming={reasoningStreaming}
            className="mt-1"
          >
            <ReasoningTrigger />
            <ReasoningContent className="select-text">
              {reasoningText}
            </ReasoningContent>
          </Reasoning>
        ) : null}
        {responseText ? (
          <MessageResponse
            streaming={streaming}
            className="select-text prose-sm max-w-full break-words text-[12px] leading-relaxed text-foreground [&_p]:break-words"
          >
            {responseText}
          </MessageResponse>
        ) : null}
      </MessageContent>
      <div className="flex flex-wrap items-center gap-1">
        {branches ? (
          <BranchControls
            current={currentBranch}
            total={branches.length}
            onNext={() =>
              setCurrentBranch((current) => (current + 1) % branches.length)
            }
            onPrevious={() =>
              setCurrentBranch(
                (current) => (current - 1 + branches.length) % branches.length,
              )
            }
          />
        ) : null}
        <RegenerateMessageAction
          canRegenerate={canRegenerate}
          item={item}
          onRegenerate={onRegenerate}
        />
        <CopyMessageAction label="Copy response" text={responseText} />
        {!ttsDisabled ? (
          <TtsMessageAction
            speaking={isTtsSpeakingThis}
            onSpeak={() => onTtsSpeak(responseText, item.id)}
            onStop={onTtsStop}
          />
        ) : null}
      </div>
    </Message>
  );
}

function ProgressRow({ text }: { text: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border/35 bg-card/60 px-2.5 py-2 text-[11px] text-muted-foreground"
      role="status"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-foreground/70" />
      <HugeiconsIcon icon={AiChat02Icon} size={12} strokeWidth={1.8} />
      <span className="truncate">{text}</span>
    </div>
  );
}

function unreachableTranscriptKind(kind: never): null {
  void kind;
  return null;
}

// Memoized so a streaming token update (which rebuilds the transcript array)
// only re-renders the rows whose props actually changed, not all ~160 items.
const TranscriptItem = memo(function TranscriptItem({
  canRegenerate,
  item,
  onForkFromTurn,
  onRollbackToTurn,
  onRegenerate,
  onToolApproval,
  onQuestionRespond,
  streaming,
  ttsSpeaking,
  ttsActiveMessageId,
  onTtsSpeak,
  onTtsStop,
}: {
  canRegenerate: boolean;
  item: PiTranscriptItem;
  onForkFromTurn?: (eventId: string) => void;
  onRollbackToTurn?: (eventId: string) => void;
  onRegenerate?: (request: PiRegenerateRequest) => void;
  onToolApproval?: (toolCallId: string, approved: boolean) => void;
  onQuestionRespond?: (questionId: string, answers: PiQuestionAnswer[]) => void;
  streaming: boolean;
  ttsSpeaking: boolean;
  ttsActiveMessageId: string | null;
  onTtsSpeak: (text: string, messageId: string) => void;
  onTtsStop: () => void;
}) {
  switch (item.kind) {
    case "assistant":
      return (
        <AssistantMessage
          canRegenerate={canRegenerate}
          item={item}
          onRegenerate={onRegenerate}
          streaming={streaming}
          ttsSpeaking={ttsSpeaking}
          ttsActiveMessageId={ttsActiveMessageId}
          onTtsSpeak={onTtsSpeak}
          onTtsStop={onTtsStop}
        />
      );
    case "user":
      return (
        <div className="group/turn relative">
          <UserMessage item={item} />
          {onForkFromTurn || onRollbackToTurn ? (
            <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover/turn:opacity-100">
              {onForkFromTurn ? (
                <button
                  type="button"
                  className="rounded-md border border-border/35 bg-card/85 px-1.5 py-0.5 text-[9.5px] text-muted-foreground hover:bg-card hover:text-foreground"
                  aria-label="Fork from this turn"
                  onClick={() => onForkFromTurn(item.id)}
                >
                  Fork
                </button>
              ) : null}
              {onRollbackToTurn ? (
                <button
                  type="button"
                  className="rounded-md border border-border/35 bg-card/85 px-1.5 py-0.5 text-[9.5px] text-muted-foreground hover:bg-card hover:text-foreground"
                  aria-label="Rollback to this turn"
                  onClick={() => onRollbackToTurn(item.id)}
                >
                  Rollback
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    case "error":
      return <ErrorRow item={item} />;
    case "progress":
      return <ProgressRow text={item.text ?? item.label} />;
    case "tool":
      return <ToolMessage item={item} onToolApproval={onToolApproval} />;
    case "question":
      return (
        <QuestionMessage item={item} onQuestionRespond={onQuestionRespond} />
      );
    case "system":
      return null;
    default:
      return unreachableTranscriptKind(item.kind);
  }
});

function latestProgressItem(
  transcript: PiTranscriptItem[],
  afterItem: PiTranscriptItem | null,
): PiTranscriptItem | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const current = transcript[index];
    if (!current) continue;
    if (afterItem && current.id === afterItem.id) {
      return null;
    }
    if (current.kind === "progress") {
      return current;
    }
  }
  return null;
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
  canRegenerate = false,
  onOpenWorkspace,
  onPopOut,
  onRegenerate,
  onForkFromTurn,
  onRollbackToTurn,
  onToolApproval,
  onQuestionRespond,
  onUsePrompt,
}: PiTranscriptProps) {
  const visibleTranscript = useMemo(
    () =>
      transcript.filter(
        (item) => item.kind !== "system" && item.kind !== "progress",
      ),
    [transcript],
  );
  const isRunning = selectedSession?.status === "running";
  const lastVisible = visibleTranscript[visibleTranscript.length - 1] ?? null;
  const latestProgress = useMemo(
    () => latestProgressItem(transcript, lastVisible),
    [lastVisible, transcript],
  );
  const streamingAssistantId =
    isRunning && lastVisible?.kind === "assistant" ? lastVisible.id : null;
  const showProgress = isRunning && lastVisible?.kind !== "assistant";
  const progressText = latestProgress?.text ?? "Pi is thinking…";
  const hasVisibleTranscript = visibleTranscript.length > 0;

  const tts = useTts();

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
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {onPopOut ? (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="size-5 rounded-md text-muted-foreground hover:text-foreground"
                aria-label="Pop out Code chat"
                title="Pop out Code chat"
                onClick={onPopOut}
              >
                <HugeiconsIcon
                  data-icon="inline-start"
                  icon={WindowsNewIcon}
                  strokeWidth={1.8}
                />
              </Button>
            ) : null}
            {onOpenWorkspace ? (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="size-5 rounded-md text-muted-foreground hover:text-foreground"
                aria-label="Open Code chat in workspace"
                title="Open Code chat in workspace"
                onClick={onOpenWorkspace}
              >
                <HugeiconsIcon
                  data-icon="inline-start"
                  icon={FullscreenIcon}
                  strokeWidth={1.8}
                />
              </Button>
            ) : null}
            <span className="text-[10px] capitalize text-muted-foreground">
              {selectedSession?.status ?? "idle"}
            </span>
          </div>
        </div>
        <Conversation
          aria-busy={isRunning}
          aria-live="polite"
          aria-relevant="additions text"
          className="min-h-0 flex-1"
        >
          <ConversationContent className="min-h-full gap-3 p-2">
            {!hasVisibleTranscript && !showProgress ? (
              <EmptyTranscript onUsePrompt={onUsePrompt} />
            ) : (
              <>
                {visibleTranscript.map((item) => (
                  // Older rows lazy-render off-screen via content-visibility;
                  // the streaming row stays eager (on-screen, updates per token).
                  <LazyRow
                    key={item.id}
                    eager={item.id === streamingAssistantId}
                  >
                    <TranscriptItem
                      canRegenerate={canRegenerate}
                      item={item}
                      onForkFromTurn={onForkFromTurn}
                      onRollbackToTurn={onRollbackToTurn}
                      onRegenerate={onRegenerate}
                      onToolApproval={onToolApproval}
                      onQuestionRespond={onQuestionRespond}
                      streaming={item.id === streamingAssistantId}
                      ttsSpeaking={tts.speaking}
                      ttsActiveMessageId={tts.activeMessageId}
                      onTtsSpeak={tts.speak}
                      onTtsStop={tts.stop}
                    />
                  </LazyRow>
                ))}
                {showProgress ? <ProgressRow text={progressText} /> : null}
              </>
            )}
          </ConversationContent>
          <ConversationScrollButton className="bottom-2 size-6" />
        </Conversation>
      </div>
    </div>
  );
}
