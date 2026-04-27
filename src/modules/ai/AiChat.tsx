import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Spinner } from "@/components/ui/spinner";
import { AiToolApproval } from "./AiToolApproval";
import { AiBrain01Icon, AiMagicIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  ChatStatus,
  DynamicToolUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
} from "ai";

type AnyToolPart = ToolUIPart | DynamicToolUIPart;
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

export function AiChatView({
  messages,
  status,
  error,
  clearError,
  addToolApprovalResponse,
}: Props) {
  const isBusy = status === "submitted" || status === "streaming";
  const lastMessage = messages[messages.length - 1];
  const showSpinner = isBusy && lastMessage?.role === "user";

  if (messages.length === 0) {
    return (
      <Conversation>
        <ConversationContent>
          <ConversationEmptyState
            icon={
              <HugeiconsIcon icon={AiMagicIcon} size={20} strokeWidth={1.5} />
            }
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
        {messages.map((m) => (
          <RenderedMessage
            key={m.id}
            message={m}
            onApproval={(id, approved) =>
              addToolApprovalResponse({ id, approved })
            }
          />
        ))}
        {showSpinner && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner />
            Thinking…
          </div>
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

function RenderedMessage({
  message,
  onApproval,
}: {
  message: UIMessage;
  onApproval: (id: string, approved: boolean) => void;
}) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    return (
      <Message from="user">
        <MessageContent>
          <p className="whitespace-pre-wrap wrap-break-word">{text}</p>
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message from={message.role}>
      <MessageContent>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="flex size-5 items-center justify-center rounded bg-accent text-accent-foreground">
            <HugeiconsIcon icon={AiBrain01Icon} size={11} strokeWidth={1.75} />
          </div>
          <span>Terax</span>
        </div>
        <div className="flex flex-col gap-3">
          {message.parts.map((part, i) => (
            <RenderedPart
              key={`${message.id}-${i}`}
              part={part as AnyPart}
              onApproval={onApproval}
            />
          ))}
        </div>
      </MessageContent>
    </Message>
  );
}

function RenderedPart({
  part,
  onApproval,
}: {
  part: AnyPart;
  onApproval: (id: string, approved: boolean) => void;
}) {
  if (part.type === "text") {
    return (
      <MessageResponse>
        {(part as unknown as { text: string }).text}
      </MessageResponse>
    );
  }

  if (part.type === "reasoning") {
    return (
      <Reasoning>
        <ReasoningTrigger />
        <ReasoningContent>
          {(part as unknown as { text: string }).text}
        </ReasoningContent>
      </Reasoning>
    );
  }

  if (
    part.type === "dynamic-tool" ||
    (typeof part.type === "string" && part.type.startsWith("tool-"))
  ) {
    return (
      <RenderedTool
        part={part as unknown as AnyToolPart}
        onApproval={onApproval}
      />
    );
  }

  return null;
}

function RenderedTool({
  part,
  onApproval,
}: {
  part: AnyToolPart;
  onApproval: (id: string, approved: boolean) => void;
}) {
  const toolName =
    part.type === "dynamic-tool"
      ? part.toolName
      : part.type.replace(/^tool-/, "");

  if (part.state === "approval-requested") {
    return (
      <AiToolApproval
        part={part as Extract<ToolUIPart, { state: "approval-requested" }>}
        toolName={toolName}
        onRespond={(approved) => onApproval(part.approval.id, approved)}
      />
    );
  }

  if (part.type === "dynamic-tool") {
    return (
      <Tool defaultOpen={part.state === "output-error"}>
        <ToolHeader
          type="dynamic-tool"
          state={part.state}
          toolName={toolName}
          title={toolName}
        />
        <ToolContent>
          <ToolInput input={part.input} />
          <ToolOutput
            output={"output" in part ? part.output : undefined}
            errorText={"errorText" in part ? part.errorText : undefined}
          />
        </ToolContent>
      </Tool>
    );
  }

  return (
    <Tool defaultOpen={part.state === "output-error"}>
      <ToolHeader type={part.type} state={part.state} title={toolName} />
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput
          output={"output" in part ? part.output : undefined}
          errorText={"errorText" in part ? part.errorText : undefined}
        />
      </ToolContent>
    </Tool>
  );
}
