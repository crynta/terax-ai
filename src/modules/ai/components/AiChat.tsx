import type { ChatStatus, UIMessage, UIMessagePart } from "ai";
import { memo, useCallback, useMemo } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { statusBorderSurfaceClass, statusDotClass } from "@/lib/statusTone";
import { cn } from "@/lib/utils";
import {
  type AgentMeta,
  type AgentRunHistoryEntry,
  sendMessage,
  useChatStore,
} from "../store/chatStore";
import { RenderedMessage } from "./AiChatMessage";

type AnyPart = UIMessagePart<Record<string, never>, Record<string, never>>;

type ApprovalArg = {
  id: string;
  approved: boolean;
  reason?: string;
};

type Props = {
  messages: UIMessage[];
  status: ChatStatus;
  error: Error | undefined;
  clearError: () => void;
  addToolApprovalResponse: (arg: ApprovalArg) => void | PromiseLike<void>;
  stop: () => void | PromiseLike<void>;
};

type AgentToolActivityItem = {
  id: string;
  name: string;
  state: string;
  status: "awaiting" | "done" | "failed" | "running";
  detail: string | null;
};

type AgentToolActivitySummary = {
  total: number;
  completed: number;
  running: number;
  awaitingApproval: number;
  failed: number;
  latestToolName: string | null;
  items: AgentToolActivityItem[];
};

const EMPTY_TOOL_ACTIVITY: AgentToolActivitySummary = {
  total: 0,
  completed: 0,
  running: 0,
  awaitingApproval: 0,
  failed: 0,
  latestToolName: null,
  items: [],
};
const MAX_RENDERED_CHAT_MESSAGES = 80;

function isToolPart(part: AnyPart): boolean {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function toolNameFromPart(part: AnyPart): string | null {
  if (part.type === "dynamic-tool") {
    return (part as unknown as { toolName?: string }).toolName ?? null;
  }
  return part.type.startsWith("tool-") ? part.type.replace(/^tool-/, "") : null;
}

function toolDetailFromPart(part: AnyPart): string | null {
  const input = (part as { input?: Record<string, unknown> }).input;
  const path = input?.path;
  if (typeof path === "string" && path.trim()) return path;
  const command = input?.command;
  if (typeof command === "string" && command.trim()) return command;
  const query = input?.query;
  if (typeof query === "string" && query.trim()) return query;
  return null;
}

function toolStatusFromState(state: string): AgentToolActivityItem["status"] {
  if (state === "approval-requested") return "awaiting";
  if (state === "output-error") return "failed";
  if (state === "output-available" || state === "approval-responded")
    return "done";
  return "running";
}

export function summarizeAgentToolActivity(
  messages: UIMessage[],
): AgentToolActivitySummary {
  const summary: AgentToolActivitySummary = {
    ...EMPTY_TOOL_ACTIVITY,
    items: [],
  };
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts as AnyPart[]) {
      if (!isToolPart(part)) continue;
      const name = toolNameFromPart(part) ?? "tool";
      const state = (part as { state?: string }).state ?? "";
      const status = toolStatusFromState(state);
      summary.total += 1;
      summary.latestToolName = name;
      if (status === "awaiting") summary.awaitingApproval += 1;
      else if (status === "failed") summary.failed += 1;
      else if (status === "done") summary.completed += 1;
      else summary.running += 1;
      summary.items.push({
        id:
          (part as { toolCallId?: string }).toolCallId ??
          (part as { approval?: { id?: string } }).approval?.id ??
          `${summary.total}-${name}`,
        name,
        state,
        status,
        detail: toolDetailFromPart(part),
      });
    }
  }
  return summary;
}

function lastUserText(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text = message.parts
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join("\n")
      .trim();
    return text.length > 0 ? text : null;
  }
  return null;
}

function formatRunDuration(
  startedAt: number | null,
  endedAt: number | null,
): string | null {
  if (!startedAt) return null;
  const elapsedMs = Math.max(0, (endedAt ?? Date.now()) - startedAt);
  const seconds = Math.round(elapsedMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

export function selectRecentAgentRuns(
  runHistory: AgentRunHistoryEntry[],
  activeSessionId: string | null,
  limit = 3,
): AgentRunHistoryEntry[] {
  return runHistory
    .filter((entry) => !activeSessionId || entry.sessionId === activeSessionId)
    .slice(0, limit);
}

function runReasonLabel(reason: AgentMeta["stopReason"]): string {
  if (reason === "cancelled") return "cancelled";
  if (reason === "paused") return "paused";
  if (reason === "error") return "error";
  return "completed";
}

function toolStatusClass(status: AgentToolActivityItem["status"]): string {
  if (status === "failed") return "bg-destructive";
  if (status === "awaiting") return statusDotClass("warning");
  if (status === "running") return statusDotClass("active");
  return "bg-foreground/65";
}

export function AiChatView({
  messages,
  status,
  error,
  clearError,
  addToolApprovalResponse,
  stop,
}: Props) {
  const isBusy = status === "submitted" || status === "streaming";
  const lastMessage = messages[messages.length - 1];
  const showSpinner = isBusy && lastMessage?.role === "user";
  const streamingMessageId =
    status === "streaming" && lastMessage?.role === "assistant"
      ? lastMessage.id
      : null;
  const agentMeta = useChatStore((s) => s.agentMeta);
  const step = agentMeta.step;
  const hitStepCap = agentMeta.hitStepCap;
  const compactionNotice = agentMeta.compactionNotice;
  const patchAgentMeta = useChatStore((s) => s.patchAgentMeta);
  const markAgentRunCancelled = useChatStore((s) => s.markAgentRunCancelled);
  const markAgentRunPaused = useChatStore((s) => s.markAgentRunPaused);
  const showContinue =
    !isBusy && hitStepCap && lastMessage?.role === "assistant";
  const hiddenMessageCount = Math.max(
    0,
    messages.length - MAX_RENDERED_CHAT_MESSAGES,
  );
  const renderedMessages =
    hiddenMessageCount > 0 ? messages.slice(hiddenMessageCount) : messages;

  const onApproval = useCallback(
    (id: string, approved: boolean) =>
      addToolApprovalResponse({ id, approved }),
    [addToolApprovalResponse],
  );

  if (messages.length === 0) {
    return (
      <Conversation>
        <ConversationContent>
          <ConversationEmptyState
            title="Ask Terax anything"
            description="Explain command output, fix errors, generate snippets, or run a task."
          />
        </ConversationContent>
      </Conversation>
    );
  }

  return (
    <Conversation>
      <ConversationContent className="gap-5 p-3">
        {hiddenMessageCount > 0 ? (
          <div
            role="note"
            className="rounded-md border border-border/45 bg-card/55 px-3 py-2 text-xs text-muted-foreground"
          >
            Showing latest {renderedMessages.length.toLocaleString()} messages.
            {hiddenMessageCount.toLocaleString()} older messages are retained in
            chat history.
          </div>
        ) : null}
        {renderedMessages.map((m) => (
          <RenderedMessage
            key={m.id}
            message={m}
            onApproval={onApproval}
            streaming={m.id === streamingMessageId}
          />
        ))}
        <AgentRunTimeline
          messages={messages}
          status={status}
          error={error}
          meta={agentMeta}
          onCancel={() => {
            markAgentRunCancelled();
            void stop();
          }}
          onPause={() => {
            markAgentRunPaused();
            void stop();
          }}
          onRetry={() => {
            clearError();
            patchAgentMeta({ stopReason: null, error: null });
            const prompt = lastUserText(messages);
            void sendMessage(
              prompt
                ? `Retry the last request and recover from the failure:\n\n${prompt}`
                : "Retry the last request and recover from the failure.",
            );
          }}
          onResume={() => {
            patchAgentMeta({ stopReason: null, hitStepCap: false });
            void sendMessage(
              "Resume the paused run from exactly where it stopped. Do not recap, just continue the task.",
            );
          }}
        />
        {compactionNotice && (
          <CompactionNotice
            droppedCount={compactionNotice.droppedCount}
            onDismiss={() => patchAgentMeta({ compactionNotice: null })}
          />
        )}
        {showSpinner && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner />
            <span className="truncate">{step ?? "Thinking…"}</span>
          </div>
        )}
        {showContinue && (
          <ContinueRow
            onContinue={() => {
              patchAgentMeta({ hitStepCap: false });
              void sendMessage(
                "Continue from where you stopped. Don't recap, just keep going.",
              );
            }}
          />
        )}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <div className="font-medium">Something went wrong.</div>
            <div className="mt-0.5 leading-relaxed opacity-90">
              {error.message}
            </div>
            <button
              type="button"
              onClick={clearError}
              className="mt-1 underline opacity-80 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

export const AgentRunTimeline = memo(function AgentRunTimeline({
  messages,
  status,
  error,
  meta,
  onCancel,
  onPause,
  onRetry,
  onResume,
}: {
  messages: UIMessage[];
  status: ChatStatus;
  error: Error | undefined;
  meta: AgentMeta;
  onCancel: () => void;
  onPause: () => void;
  onRetry: () => void;
  onResume: () => void;
}) {
  const isBusy = status === "submitted" || status === "streaming";
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const runHistory = useChatStore((s) => s.agentRunHistory);
  const activity = useMemo(
    () => summarizeAgentToolActivity(messages),
    [messages],
  );
  const recentRuns = useMemo(
    () => selectRecentAgentRuns(runHistory, activeSessionId),
    [activeSessionId, runHistory],
  );
  const awaitingApproval =
    meta.approvalsPending > 0 || activity.awaitingApproval > 0;
  const show =
    isBusy ||
    awaitingApproval ||
    error !== undefined ||
    meta.stopReason === "cancelled" ||
    meta.stopReason === "paused" ||
    activity.total > 0 ||
    recentRuns.length > 0;
  if (!show) return null;

  const duration = formatRunDuration(meta.runStartedAt, meta.runEndedAt);
  const statusLabel = error
    ? "Error"
    : awaitingApproval
      ? "Awaiting approval"
      : isBusy
        ? status === "submitted"
          ? "Thinking"
          : "Streaming"
        : meta.stopReason === "paused"
          ? "Paused"
          : meta.stopReason === "cancelled"
            ? "Cancelled"
            : "Complete";
  const statusTone = error
    ? "bg-destructive"
    : awaitingApproval
      ? statusDotClass("warning")
      : isBusy
        ? statusDotClass("active")
        : meta.stopReason === "paused"
          ? statusDotClass("warning")
          : meta.stopReason === "cancelled"
            ? "bg-muted-foreground"
            : "bg-foreground/65";

  return (
    <div className="rounded-lg border border-border/45 bg-card/60 px-2.5 py-2 text-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", statusTone)} />
        <span className="shrink-0 font-medium text-foreground">
          Run timeline
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {statusLabel}
          {duration ? ` · ${duration}` : ""}
          {meta.step ? ` · ${meta.step}` : ""}
        </span>
        {isBusy ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="xs"
              variant="secondary"
              className="h-5 rounded-md px-1.5 text-[10px]"
              onClick={onPause}
            >
              Pause
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="h-5 rounded-md px-1.5 text-[10px]"
              onClick={onCancel}
            >
              Cancel
            </Button>
          </div>
        ) : error ? (
          <Button
            type="button"
            size="xs"
            variant="secondary"
            className="h-5 rounded-md px-1.5 text-[10px]"
            onClick={onRetry}
          >
            Retry
          </Button>
        ) : meta.stopReason === "paused" ? (
          <Button
            type="button"
            size="xs"
            variant="secondary"
            className="h-5 rounded-md px-1.5 text-[10px]"
            onClick={onResume}
          >
            Resume
          </Button>
        ) : meta.stopReason === "cancelled" ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-5 rounded-md px-1.5 text-[10px]"
            onClick={onRetry}
          >
            Retry
          </Button>
        ) : null}
      </div>
      {activity.total > 0 ? (
        <>
          <div className="mt-1.5 flex min-w-0 flex-wrap gap-1 text-[10px] text-muted-foreground/75">
            <span className="rounded-md border border-border/35 bg-background/65 px-1.5 py-0.5 tabular-nums">
              {activity.total} tool{activity.total === 1 ? "" : "s"}
            </span>
            {activity.completed > 0 ? (
              <span className="rounded-md border border-border/35 bg-background/65 px-1.5 py-0.5 tabular-nums">
                {activity.completed} done
              </span>
            ) : null}
            {activity.running > 0 ? (
              <span className="rounded-md border border-border/35 bg-background/65 px-1.5 py-0.5 tabular-nums">
                {activity.running} running
              </span>
            ) : null}
            {activity.awaitingApproval > 0 ? (
              <span
                className={cn(
                  "rounded-md border px-1.5 py-0.5 tabular-nums",
                  statusBorderSurfaceClass("warning"),
                )}
              >
                {activity.awaitingApproval} needs approval
              </span>
            ) : null}
            {activity.failed > 0 ? (
              <span className="rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 tabular-nums text-destructive">
                {activity.failed} failed
              </span>
            ) : null}
            {activity.latestToolName ? (
              <span className="min-w-0 truncate rounded-md border border-border/35 bg-background/65 px-1.5 py-0.5 font-mono">
                latest {activity.latestToolName}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {activity.items.slice(-4).map((item) => (
              <div
                key={item.id}
                className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/25 bg-background/45 px-1.5 py-1 text-[10px] text-muted-foreground"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    toolStatusClass(item.status),
                  )}
                />
                <span className="shrink-0 font-mono text-foreground">
                  {item.name}
                </span>
                <span className="shrink-0 opacity-70">{item.status}</span>
                {item.detail ? (
                  <span className="min-w-0 flex-1 truncate font-mono opacity-75">
                    {item.detail}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
      {recentRuns.length > 0 ? (
        <div className="mt-1.5 flex flex-col gap-0.5 border-t border-border/30 pt-1.5">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            Recent runs
          </div>
          {recentRuns.map((run) => (
            <div
              key={run.id}
              className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground"
            >
              <span className="shrink-0 tabular-nums">
                {formatRunDuration(run.startedAt, run.endedAt) ?? "0s"}
              </span>
              <span className="shrink-0 rounded-md border border-border/30 bg-background/55 px-1 py-0.5">
                {runReasonLabel(run.stopReason)}
              </span>
              {run.step ? (
                <span className="min-w-0 flex-1 truncate">{run.step}</span>
              ) : run.error ? (
                <span className="min-w-0 flex-1 truncate text-destructive">
                  {run.error}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});

const CompactionNotice = memo(function CompactionNotice({
  droppedCount,
  onDismiss,
}: {
  droppedCount: number;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full opacity-80",
          statusDotClass("warning"),
        )}
      />
      <span className="flex-1 truncate">
        Context compacted: {droppedCount} older tool result
        {droppedCount === 1 ? "" : "s"} elided to save tokens.
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-[10.5px] underline opacity-70 hover:opacity-100"
      >
        Dismiss
      </button>
    </div>
  );
});

const ContinueRow = memo(function ContinueRow({
  onContinue,
}: {
  onContinue: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/50 bg-card/60 px-2.5 py-1.5 text-[11px]">
      <span className="flex-1 text-muted-foreground">
        Hit the step limit. Continue to keep going.
      </span>
      <button
        type="button"
        onClick={onContinue}
        className="rounded-md border border-border/60 bg-background px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
      >
        Continue
      </button>
    </div>
  );
});
