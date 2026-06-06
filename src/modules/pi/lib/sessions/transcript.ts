import {
  PI_SESSION_EVENT,
  type PiPromptContext,
  type PiSessionBranch,
  type PiSessionEvent,
  type PiTranscriptBranch,
  type PiTranscriptItem,
} from "./types";
import {
  chronologicalEvents,
  eventBranch,
  eventContext,
  eventText,
  eventToolCallId,
  eventToolName,
  eventToolOutput,
  joinDeltaText,
} from "./events";

type RegeneratePrompt = {
  branchGroupId: string;
  promptContext?: PiPromptContext;
  promptText: string | null;
  userItem?: PiTranscriptItem;
};

function createAssistantItem(
  event: PiSessionEvent,
  text: string,
  prompt?: RegeneratePrompt,
): PiTranscriptItem {
  return {
    id: event.id,
    kind: "assistant",
    label: "Pi",
    text,
    eventIds: [event.id],
    createdAt: event.createdAt,
    branchGroupId: prompt?.branchGroupId,
    branchIndex: prompt ? 0 : undefined,
    promptText: prompt?.promptText,
    promptContext: prompt?.promptContext,
  };
}

type TranscriptBranchGroup = {
  userItem?: PiTranscriptItem;
  assistantItem?: PiTranscriptItem;
  promptText?: string | null;
  promptContext?: PiPromptContext;
};

function groupForBranch(
  groups: Map<string, TranscriptBranchGroup>,
  branch: PiSessionBranch,
): TranscriptBranchGroup {
  let group = groups.get(branch.groupId);
  if (!group) {
    group = {};
    groups.set(branch.groupId, group);
  }
  return group;
}

function seedBranchGroupFromPrompt(
  groups: Map<string, TranscriptBranchGroup>,
  prompt: RegeneratePrompt,
): void {
  const group = groupForBranch(groups, {
    groupId: prompt.branchGroupId,
    index: 0,
  });
  if (group.promptText === undefined) {
    group.promptText = prompt.promptText;
  }
  if (group.promptContext === undefined) {
    group.promptContext = prompt.promptContext;
  }
  if (group.userItem === undefined && prompt.userItem) {
    prompt.userItem.branchGroupId = prompt.branchGroupId;
    prompt.userItem.branchIndex = 0;
    group.userItem = prompt.userItem;
  }
}

function createBranchUserItem(
  event: PiSessionEvent,
  branch: PiSessionBranch,
): PiTranscriptItem {
  return {
    id: event.id,
    kind: "user",
    label: "Prompt",
    text: eventText(event),
    eventIds: [event.id],
    createdAt: event.createdAt,
    context: eventContext(event),
    branchGroupId: branch.groupId,
    branchIndex: branch.index,
  };
}

function appendBranchInput(
  transcript: PiTranscriptItem[],
  groups: Map<string, TranscriptBranchGroup>,
  event: PiSessionEvent,
  branch: PiSessionBranch,
): void {
  const group = groupForBranch(groups, branch);
  const promptText = eventText(event);
  const promptContext = eventContext(event);

  if (group.promptText === undefined) {
    group.promptText = promptText;
  }
  if (group.promptContext === undefined) {
    group.promptContext = promptContext;
  }

  if (group.userItem) {
    group.userItem.eventIds.push(event.id);
    group.userItem.createdAt = event.createdAt;
    return;
  }

  const item = createBranchUserItem(event, branch);
  group.userItem = item;
  transcript.push(item);
}

function createBranchedAssistantItem(
  event: PiSessionEvent,
  branch: PiSessionBranch,
  group: TranscriptBranchGroup,
): PiTranscriptItem {
  return {
    id: event.id,
    kind: "assistant",
    label: "Pi",
    text: null,
    eventIds: [],
    createdAt: event.createdAt,
    branchGroupId: branch.groupId,
    branchIndex: branch.index,
    branches: [],
    promptText: group.promptText,
    promptContext: group.promptContext,
  };
}

function syncAssistantBranchSummary(item: PiTranscriptItem): void {
  const branches = item.branches ?? [];
  const latest = branches.reduce<PiTranscriptBranch | null>(
    (current, branch) =>
      current === null || branch.branchIndex > current.branchIndex
        ? branch
        : current,
    null,
  );
  if (!latest) return;

  item.text = latest.text;
  item.reasoningText = latest.reasoningText;
  item.reasoningEventIds = latest.reasoningEventIds;
  item.branchIndex = latest.branchIndex;
  item.createdAt = latest.createdAt;
  item.eventIds = branches.flatMap((branch) => branch.eventIds);
}

function applyAssistantBranchPart(
  transcript: PiTranscriptItem[],
  groups: Map<string, TranscriptBranchGroup>,
  event: PiSessionEvent,
  branch: PiSessionBranch,
  mode: "delta" | "final",
  part: "reasoning" | "text",
): void {
  const text = eventText(event);
  if (text === null || (mode === "delta" && text.length === 0)) {
    return;
  }

  const group = groupForBranch(groups, branch);
  let assistantItem = group.assistantItem;
  if (!assistantItem) {
    assistantItem = createBranchedAssistantItem(event, branch, group);
    group.assistantItem = assistantItem;
    transcript.push(assistantItem);
  }

  const branches = assistantItem.branches ?? [];
  assistantItem.branches = branches;
  let transcriptBranch = branches.find(
    (candidate) => candidate.branchIndex === branch.index,
  );
  if (!transcriptBranch) {
    transcriptBranch = {
      id: event.id,
      branchIndex: branch.index,
      text: null,
      eventIds: [],
      createdAt: event.createdAt,
    };
    branches.push(transcriptBranch);
    branches.sort((left, right) => left.branchIndex - right.branchIndex);
  }

  if (part === "reasoning") {
    transcriptBranch.reasoningText =
      mode === "final"
        ? text
        : joinDeltaText(transcriptBranch.reasoningText ?? null, text);
    transcriptBranch.reasoningEventIds = [
      ...(transcriptBranch.reasoningEventIds ?? []),
      event.id,
    ];
  } else {
    transcriptBranch.text =
      mode === "final" ? text : joinDeltaText(transcriptBranch.text, text);
  }
  transcriptBranch.eventIds.push(event.id);
  transcriptBranch.createdAt = event.createdAt;
  syncAssistantBranchSummary(assistantItem);
}

function applyAssistantBranchText(
  transcript: PiTranscriptItem[],
  groups: Map<string, TranscriptBranchGroup>,
  event: PiSessionEvent,
  branch: PiSessionBranch,
  mode: "delta" | "final",
): void {
  applyAssistantBranchPart(transcript, groups, event, branch, mode, "text");
}

function applyAssistantBranchReasoning(
  transcript: PiTranscriptItem[],
  groups: Map<string, TranscriptBranchGroup>,
  event: PiSessionEvent,
  branch: PiSessionBranch,
  mode: "delta" | "final",
): void {
  applyAssistantBranchPart(
    transcript,
    groups,
    event,
    branch,
    mode,
    "reasoning",
  );
}

function appendAssistantDelta(
  transcript: PiTranscriptItem[],
  event: PiSessionEvent,
  groups: Map<string, TranscriptBranchGroup>,
  prompt?: RegeneratePrompt,
): void {
  const branch = eventBranch(event);
  if (branch) {
    applyAssistantBranchText(transcript, groups, event, branch, "delta");
    return;
  }

  if (prompt) {
    seedBranchGroupFromPrompt(groups, prompt);
    applyAssistantBranchText(
      transcript,
      groups,
      event,
      { groupId: prompt.branchGroupId, index: 0 },
      "delta",
    );
    return;
  }

  const text = eventText(event);
  if (text === null || text.length === 0) {
    return;
  }

  const previous = transcript[transcript.length - 1];
  if (previous?.kind === "assistant") {
    previous.text = joinDeltaText(previous.text, text);
    previous.eventIds.push(event.id);
    previous.createdAt = event.createdAt;
    return;
  }

  transcript.push(createAssistantItem(event, text, prompt));
}

function applyAssistantFinalText(
  transcript: PiTranscriptItem[],
  event: PiSessionEvent,
  groups: Map<string, TranscriptBranchGroup>,
  prompt?: RegeneratePrompt,
): void {
  const branch = eventBranch(event);
  if (branch) {
    applyAssistantBranchText(transcript, groups, event, branch, "final");
    return;
  }

  if (prompt) {
    seedBranchGroupFromPrompt(groups, prompt);
    applyAssistantBranchText(
      transcript,
      groups,
      event,
      { groupId: prompt.branchGroupId, index: 0 },
      "final",
    );
    return;
  }

  const text = eventText(event);
  if (text === null) {
    return;
  }

  const previous = transcript[transcript.length - 1];
  if (previous?.kind === "assistant") {
    previous.text = text;
    previous.eventIds.push(event.id);
    previous.createdAt = event.createdAt;
    return;
  }

  transcript.push(createAssistantItem(event, text, prompt));
}

function applyAssistantReasoning(
  transcript: PiTranscriptItem[],
  event: PiSessionEvent,
  groups: Map<string, TranscriptBranchGroup>,
  mode: "delta" | "final",
  prompt?: RegeneratePrompt,
): void {
  const branch = eventBranch(event);
  if (branch) {
    applyAssistantBranchReasoning(transcript, groups, event, branch, mode);
    return;
  }

  if (prompt) {
    seedBranchGroupFromPrompt(groups, prompt);
    applyAssistantBranchReasoning(
      transcript,
      groups,
      event,
      { groupId: prompt.branchGroupId, index: 0 },
      mode,
    );
    return;
  }

  const text = eventText(event);
  if (text === null || (mode === "delta" && text.length === 0)) {
    return;
  }

  const previous = transcript[transcript.length - 1];
  if (previous?.kind === "assistant") {
    previous.reasoningText =
      mode === "final"
        ? text
        : joinDeltaText(previous.reasoningText ?? null, text);
    previous.reasoningEventIds = [
      ...(previous.reasoningEventIds ?? []),
      event.id,
    ];
    previous.eventIds.push(event.id);
    previous.createdAt = event.createdAt;
    return;
  }

  transcript.push({
    ...createAssistantItem(event, "", prompt),
    text: null,
    reasoningText: text,
    reasoningEventIds: [event.id],
  });
}

function appendProgress(
  transcript: PiTranscriptItem[],
  event: PiSessionEvent,
): void {
  const item = transcriptItemForEvent(event);
  if (item === null) {
    return;
  }

  const previous = transcript[transcript.length - 1];
  if (previous?.kind === "progress") {
    previous.text = item.text;
    previous.eventIds.push(event.id);
    previous.createdAt = event.createdAt;
    return;
  }

  transcript.push(item);
}

function findToolItem(
  transcript: PiTranscriptItem[],
  toolCallId: string,
): PiTranscriptItem | undefined {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item?.kind === "tool" && item.toolCallId === toolCallId) {
      return item;
    }
  }
  return undefined;
}

function createToolItem(event: PiSessionEvent): PiTranscriptItem | null {
  const toolCallId = eventToolCallId(event);
  const toolName = eventToolName(event);
  if (!toolCallId || !toolName) return null;
  const branch = eventBranch(event);

  return {
    id: event.id,
    kind: "tool",
    label: toolName,
    text: null,
    eventIds: [event.id],
    createdAt: event.createdAt,
    toolCallId,
    toolName,
    toolInput: event.payload.input,
    toolState: "input-available",
    branchGroupId: branch?.groupId,
    branchIndex: branch?.index,
  };
}

function applyToolEvent(
  transcript: PiTranscriptItem[],
  event: PiSessionEvent,
): void {
  const toolCallId = eventToolCallId(event);
  const toolName = eventToolName(event);
  if (!toolCallId || !toolName) return;

  let item = findToolItem(transcript, toolCallId);
  if (!item) {
    item = createToolItem(event) ?? undefined;
    if (!item) return;
    transcript.push(item);
  } else {
    item.eventIds.push(event.id);
    item.createdAt = event.createdAt;
    if (item.toolInput === undefined && event.payload.input !== undefined) {
      item.toolInput = event.payload.input;
    }
  }

  item.toolName = toolName;
  switch (event.type) {
    case PI_SESSION_EVENT.ToolStart:
      item.toolState = "input-available";
      break;
    case PI_SESSION_EVENT.ToolUpdate:
      item.toolState = "input-available";
      item.toolOutput = eventToolOutput(event) ?? item.toolOutput;
      break;
    case PI_SESSION_EVENT.ToolApprovalRequested:
      item.toolState = "approval-requested";
      item.toolApprovalId =
        typeof event.payload.approvalId === "string"
          ? event.payload.approvalId
          : toolCallId;
      break;
    case PI_SESSION_EVENT.ToolApprovalResponded:
      item.toolApproved = event.payload.approved === true;
      item.toolState = item.toolApproved
        ? "approval-responded"
        : "output-denied";
      break;
    case PI_SESSION_EVENT.ToolResult:
      item.toolOutput = eventToolOutput(event);
      item.toolErrorText =
        typeof event.payload.errorText === "string"
          ? event.payload.errorText
          : null;
      item.toolState =
        event.payload.isError === true
          ? item.toolApproved === false
            ? "output-denied"
            : "output-error"
          : "output-available";
      break;
  }
}

function expireRequestedToolApprovals(
  transcript: PiTranscriptItem[],
  event: PiSessionEvent,
): void {
  for (const item of transcript) {
    if (item.kind !== "tool" || item.toolState !== "approval-requested") {
      continue;
    }
    item.toolApproved = false;
    item.toolState = "output-denied";
    item.toolErrorText = "Approval expired when the Pi session stopped.";
    item.eventIds.push(event.id);
    item.createdAt = event.createdAt;
  }
}

function transcriptItemForEvent(
  event: PiSessionEvent,
): PiTranscriptItem | null {
  switch (event.type) {
    case PI_SESSION_EVENT.Created:
      return {
        id: event.id,
        kind: "system",
        label: "Created",
        text: null,
        eventIds: [event.id],
        createdAt: event.createdAt,
      };
    case PI_SESSION_EVENT.Resumed:
      return {
        id: event.id,
        kind: "system",
        label: "Resumed",
        text: "SDK session restored",
        eventIds: [event.id],
        createdAt: event.createdAt,
      };
    case PI_SESSION_EVENT.Input:
      return {
        id: event.id,
        kind: "user",
        label: "Prompt",
        text: eventText(event),
        eventIds: [event.id],
        createdAt: event.createdAt,
        context: eventContext(event),
      };
    case PI_SESSION_EVENT.Status:
      return {
        id: event.id,
        kind: "system",
        label: "Status",
        text:
          typeof event.payload.status === "string"
            ? event.payload.status
            : "updated",
        eventIds: [event.id],
        createdAt: event.createdAt,
      };
    case PI_SESSION_EVENT.Progress:
      return {
        id: event.id,
        kind: "progress",
        label: "Progress",
        text: eventText(event) ?? "Pi is working…",
        eventIds: [event.id],
        createdAt: event.createdAt,
      };
    case PI_SESSION_EVENT.Error:
      return {
        id: event.id,
        kind: "error",
        label: "Error",
        text:
          typeof event.payload.message === "string"
            ? event.payload.message
            : "Unknown error",
        eventIds: [event.id],
        createdAt: event.createdAt,
      };
    default:
      return null;
  }
}

export function annotatePiSessionEventBranch(
  event: PiSessionEvent,
  branch: PiSessionBranch,
): PiSessionEvent {
  if (
    event.type !== PI_SESSION_EVENT.Input &&
    event.type !== PI_SESSION_EVENT.OutputDelta &&
    event.type !== PI_SESSION_EVENT.OutputText &&
    event.type !== PI_SESSION_EVENT.Progress &&
    event.type !== PI_SESSION_EVENT.ReasoningDelta &&
    event.type !== PI_SESSION_EVENT.ReasoningText &&
    !event.type.startsWith("session.tool.")
  ) {
    return event;
  }
  if (eventBranch(event)) {
    return event;
  }

  return {
    ...event,
    payload: {
      ...event.payload,
      branch: {
        groupId: branch.groupId,
        index: branch.index,
        ...(branch.regeneratedFromEventId
          ? { regeneratedFromEventId: branch.regeneratedFromEventId }
          : {}),
      },
    },
  };
}

export function annotatePiSessionEventsBranch(
  events: PiSessionEvent[],
  branch: PiSessionBranch,
): PiSessionEvent[] {
  return events.map((event) => annotatePiSessionEventBranch(event, branch));
}

export function nextPiRegenerateBranchIndex(
  transcript: PiTranscriptItem[],
  branchGroupId: string,
): number {
  const assistant = transcript.find(
    (item) => item.kind === "assistant" && item.branchGroupId === branchGroupId,
  );
  const highestBranchIndex = assistant?.branches?.reduce(
    (highest, branch) => Math.max(highest, branch.branchIndex),
    -1,
  );
  return Math.max((highestBranchIndex ?? 0) + 1, 1);
}

export function buildPiSessionTranscript(
  events: PiSessionEvent[],
): PiTranscriptItem[] {
  const transcript: PiTranscriptItem[] = [];
  const branchGroups = new Map<string, TranscriptBranchGroup>();
  let lastPromptForRegenerate: RegeneratePrompt | undefined;

  for (const event of chronologicalEvents(events)) {
    if (event.type === PI_SESSION_EVENT.Input) {
      const branch = eventBranch(event);
      if (branch) {
        lastPromptForRegenerate = undefined;
        appendBranchInput(transcript, branchGroups, event, branch);
        continue;
      }

      const item = transcriptItemForEvent(event);
      if (item !== null) {
        transcript.push(item);
        lastPromptForRegenerate = {
          branchGroupId: event.id,
          promptText: item.text,
          promptContext: item.context,
          userItem: item,
        };
      }
      continue;
    }
    if (event.type === PI_SESSION_EVENT.Progress) {
      appendProgress(transcript, event);
      continue;
    }
    if (event.type.startsWith("session.tool.")) {
      applyToolEvent(transcript, event);
      continue;
    }
    if (event.type === PI_SESSION_EVENT.ReasoningDelta) {
      applyAssistantReasoning(
        transcript,
        event,
        branchGroups,
        "delta",
        lastPromptForRegenerate,
      );
      continue;
    }
    if (event.type === PI_SESSION_EVENT.ReasoningText) {
      applyAssistantReasoning(
        transcript,
        event,
        branchGroups,
        "final",
        lastPromptForRegenerate,
      );
      continue;
    }
    if (event.type === PI_SESSION_EVENT.OutputDelta) {
      appendAssistantDelta(
        transcript,
        event,
        branchGroups,
        lastPromptForRegenerate,
      );
      continue;
    }
    if (event.type === PI_SESSION_EVENT.OutputText) {
      applyAssistantFinalText(
        transcript,
        event,
        branchGroups,
        lastPromptForRegenerate,
      );
      continue;
    }

    if (
      event.type === PI_SESSION_EVENT.Error ||
      (event.type === PI_SESSION_EVENT.Status && event.payload.status !== "running")
    ) {
      lastPromptForRegenerate = undefined;
      expireRequestedToolApprovals(transcript, event);
    }

    const item = transcriptItemForEvent(event);
    if (item !== null) {
      transcript.push(item);
    }
  }
  return transcript;
}
