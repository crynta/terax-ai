import {
  isPiThinkingLevel,
  type PiThinkingLevel,
} from "@/modules/pi/lib/provider";

export type PiSessionStatus = "idle" | "running" | "stopped" | "error";

export type PiSession = {
  id: string;
  title: string;
  cwd?: string | null;
  status: PiSessionStatus;
  createdAt: string;
  updatedAt: string;
  lastPrompt: string | null;
  thinkingLevel?: PiThinkingLevel | null;
  sdkSessionFile?: string | null;
};

export type PiPromptContext = {
  workspaceRoot?: string | null;
  activeTerminalCwd?: string | null;
  activeFile?: string | null;
  activeTerminalPrivate?: boolean;
};

export type PiSessionEvent = {
  id: string;
  type: string;
  sessionId: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type PiSessionsList = {
  sessions: PiSession[];
  events: PiSessionEvent[];
};

export type PiSessionCreateResult = {
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionSendResult = {
  accepted: boolean;
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionResumeResult = {
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionRenameResult = {
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionDeleteResult = {
  events: PiSessionEvent[];
};

export type PiSessionToolRespondResult = {
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionStopResult = {
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionBranch = {
  groupId: string;
  index: number;
  regeneratedFromEventId?: string | null;
};

export type PiTranscriptBranch = {
  id: string;
  branchIndex: number;
  text: string | null;
  reasoningText?: string | null;
  eventIds: string[];
  reasoningEventIds?: string[];
  createdAt: string;
};

export type PiToolState =
  | "approval-requested"
  | "approval-responded"
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-denied"
  | "output-error";

export type PiToolOutput = {
  content: string;
  details: unknown | null;
};

export type PiTranscriptItem = {
  id: string;
  kind: "assistant" | "error" | "progress" | "system" | "tool" | "user";
  label: string;
  text: string | null;
  eventIds: string[];
  createdAt: string;
  context?: PiPromptContext;
  reasoningText?: string | null;
  reasoningEventIds?: string[];
  branchGroupId?: string;
  branchIndex?: number;
  branches?: PiTranscriptBranch[];
  promptText?: string | null;
  promptContext?: PiPromptContext;
  toolCallId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: PiToolOutput;
  toolState?: PiToolState;
  toolErrorText?: string | null;
  toolApprovalId?: string;
  toolApproved?: boolean | null;
};

export const MAX_PI_PROMPT_CHARS = 20_000;

const DEFAULT_EVENT_LIMIT = 500;

function eventTimestamp(event: PiSessionEvent): number {
  const timestamp = Date.parse(event.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function eventSequence(event: PiSessionEvent): number | null {
  const restartSafeSequence = event.id.match(/^evt_[a-z0-9]+_(\d+)_/i)?.[1];
  if (restartSafeSequence) {
    const parsed = Number(restartSafeSequence);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const legacySequence = event.id.match(/^evt-(\d+)$/)?.[1];
  if (legacySequence) {
    const parsed = Number(legacySequence);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function comparePiSessionEventsAscending(
  left: PiSessionEvent,
  right: PiSessionEvent,
): number {
  const timestampOrder = eventTimestamp(left) - eventTimestamp(right);
  if (timestampOrder !== 0) return timestampOrder;

  const leftSequence = eventSequence(left);
  const rightSequence = eventSequence(right);
  if (leftSequence !== null && rightSequence !== null) {
    const sequenceOrder = leftSequence - rightSequence;
    if (sequenceOrder !== 0) return sequenceOrder;
  }

  return left.id.localeCompare(right.id);
}

function eventText(event: PiSessionEvent): string | null {
  return typeof event.payload.text === "string" ? event.payload.text : null;
}

function eventContext(event: PiSessionEvent): PiPromptContext | undefined {
  const context = event.payload.context;
  if (
    context === null ||
    typeof context !== "object" ||
    Array.isArray(context)
  ) {
    return undefined;
  }

  const raw = context as Record<string, unknown>;
  const next: PiPromptContext = {};
  if (typeof raw.workspaceRoot === "string") {
    next.workspaceRoot = raw.workspaceRoot;
  }
  if (typeof raw.activeTerminalCwd === "string") {
    next.activeTerminalCwd = raw.activeTerminalCwd;
  }
  if (typeof raw.activeFile === "string") {
    next.activeFile = raw.activeFile;
  }
  if (raw.activeTerminalPrivate === true) {
    next.activeTerminalPrivate = true;
  }

  return Object.keys(next).length === 0 ? undefined : next;
}

function eventBranch(event: PiSessionEvent): PiSessionBranch | undefined {
  const branch = event.payload.branch;
  if (branch === null || typeof branch !== "object" || Array.isArray(branch)) {
    return undefined;
  }

  const raw = branch as Record<string, unknown>;
  if (typeof raw.groupId !== "string" || raw.groupId.trim() === "") {
    return undefined;
  }
  if (
    typeof raw.index !== "number" ||
    !Number.isInteger(raw.index) ||
    raw.index < 0
  ) {
    return undefined;
  }

  return {
    groupId: raw.groupId,
    index: raw.index,
    regeneratedFromEventId:
      typeof raw.regeneratedFromEventId === "string"
        ? raw.regeneratedFromEventId
        : undefined,
  };
}

function eventToolCallId(event: PiSessionEvent): string | null {
  return typeof event.payload.toolCallId === "string"
    ? event.payload.toolCallId
    : null;
}

function eventToolName(event: PiSessionEvent): string | null {
  return typeof event.payload.toolName === "string"
    ? event.payload.toolName
    : null;
}

function eventToolOutput(event: PiSessionEvent): PiToolOutput | undefined {
  const output = event.payload.output;
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return undefined;
  }
  const raw = output as Record<string, unknown>;
  return {
    content: typeof raw.content === "string" ? raw.content : "",
    details: raw.details ?? null,
  };
}

function isPiSessionStatus(value: unknown): value is PiSessionStatus {
  return (
    value === "idle" ||
    value === "running" ||
    value === "stopped" ||
    value === "error"
  );
}

function eventSessionSnapshot(event: PiSessionEvent): PiSession | null {
  const value = event.payload.session;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.id !== event.sessionId ||
    typeof candidate.title !== "string" ||
    !isPiSessionStatus(candidate.status) ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    !(typeof candidate.lastPrompt === "string" || candidate.lastPrompt === null)
  ) {
    return null;
  }

  const cwd = candidate.cwd;
  const thinkingLevel = candidate.thinkingLevel;
  const sdkSessionFile = candidate.sdkSessionFile;
  return {
    id: candidate.id,
    title: candidate.title,
    status: candidate.status,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    lastPrompt: candidate.lastPrompt,
    ...(typeof cwd === "string" || cwd === null ? { cwd } : {}),
    ...(thinkingLevel === null || isPiThinkingLevel(thinkingLevel)
      ? { thinkingLevel }
      : {}),
    ...(typeof sdkSessionFile === "string" || sdkSessionFile === null
      ? { sdkSessionFile }
      : {}),
  };
}

function chronologicalEvents(events: PiSessionEvent[]): PiSessionEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const order = comparePiSessionEventsAscending(a.event, b.event);
      return order === 0 ? a.index - b.index : order;
    })
    .map(({ event }) => event);
}

function joinDeltaText(current: string | null, delta: string): string {
  if (current === null || current.length === 0) {
    return delta;
  }
  if (
    /^\s/.test(delta) ||
    /^[!%),.:;?\]}]/.test(delta) ||
    /[\s([{]$/.test(current)
  ) {
    return `${current}${delta}`;
  }
  return `${current} ${delta}`;
}

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
    case "session.tool.start":
      item.toolState = "input-available";
      break;
    case "session.tool.update":
      item.toolState = "input-available";
      item.toolOutput = eventToolOutput(event) ?? item.toolOutput;
      break;
    case "session.tool.approval.requested":
      item.toolState = "approval-requested";
      item.toolApprovalId =
        typeof event.payload.approvalId === "string"
          ? event.payload.approvalId
          : toolCallId;
      break;
    case "session.tool.approval.responded":
      item.toolApproved = event.payload.approved === true;
      item.toolState = item.toolApproved
        ? "approval-responded"
        : "output-denied";
      break;
    case "session.tool.result":
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
    case "session.created":
      return {
        id: event.id,
        kind: "system",
        label: "Created",
        text: null,
        eventIds: [event.id],
        createdAt: event.createdAt,
      };
    case "session.resumed":
      return {
        id: event.id,
        kind: "system",
        label: "Resumed",
        text: "SDK session restored",
        eventIds: [event.id],
        createdAt: event.createdAt,
      };
    case "session.input":
      return {
        id: event.id,
        kind: "user",
        label: "Prompt",
        text: eventText(event),
        eventIds: [event.id],
        createdAt: event.createdAt,
        context: eventContext(event),
      };
    case "session.status":
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
    case "session.progress":
      return {
        id: event.id,
        kind: "progress",
        label: "Progress",
        text: eventText(event) ?? "Pi is working…",
        eventIds: [event.id],
        createdAt: event.createdAt,
      };
    case "session.error":
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
    event.type !== "session.input" &&
    event.type !== "session.output.delta" &&
    event.type !== "session.output.text" &&
    event.type !== "session.progress" &&
    event.type !== "session.reasoning.delta" &&
    event.type !== "session.reasoning.text" &&
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
    if (event.type === "session.input") {
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
    if (event.type === "session.progress") {
      appendProgress(transcript, event);
      continue;
    }
    if (event.type.startsWith("session.tool.")) {
      applyToolEvent(transcript, event);
      continue;
    }
    if (event.type === "session.reasoning.delta") {
      applyAssistantReasoning(
        transcript,
        event,
        branchGroups,
        "delta",
        lastPromptForRegenerate,
      );
      continue;
    }
    if (event.type === "session.reasoning.text") {
      applyAssistantReasoning(
        transcript,
        event,
        branchGroups,
        "final",
        lastPromptForRegenerate,
      );
      continue;
    }
    if (event.type === "session.output.delta") {
      appendAssistantDelta(
        transcript,
        event,
        branchGroups,
        lastPromptForRegenerate,
      );
      continue;
    }
    if (event.type === "session.output.text") {
      applyAssistantFinalText(
        transcript,
        event,
        branchGroups,
        lastPromptForRegenerate,
      );
      continue;
    }

    if (
      event.type === "session.error" ||
      (event.type === "session.status" && event.payload.status !== "running")
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

export function mergePiSessionEvents(
  current: PiSessionEvent[],
  incoming: PiSessionEvent[],
  limit = DEFAULT_EVENT_LIMIT,
): PiSessionEvent[] {
  if (limit <= 0) {
    return [];
  }

  const byId = new Map<string, PiSessionEvent>();
  for (const event of current) {
    byId.set(event.id, event);
  }
  for (const event of incoming) {
    byId.set(event.id, event);
  }

  return Array.from(byId.values())
    .sort((a, b) => comparePiSessionEventsAscending(b, a))
    .slice(0, limit);
}

export function isPiSessionSendable(
  session: PiSession | null | undefined,
): boolean {
  return session?.status === "idle" || session?.status === "error";
}

export function markPiSessionsStopped(sessions: PiSession[]): PiSession[] {
  return sessions.map((session) =>
    session.status === "stopped" ? session : { ...session, status: "stopped" },
  );
}

export function mergePiSessionSnapshots(
  current: PiSession[],
  live: PiSession[],
  options: { missingStatus?: PiSessionStatus } = {},
): PiSession[] {
  const liveIds = new Set(live.map((session) => session.id));
  const historyOnly = current
    .filter((session) => !liveIds.has(session.id))
    .map((session) =>
      options.missingStatus === undefined
        ? session
        : { ...session, status: options.missingStatus },
    );
  return [...live, ...historyOnly];
}

export function applyPiSessionEvents(
  sessions: PiSession[],
  events: PiSessionEvent[],
): PiSession[] {
  const byId = new Map<string, PiSession>();
  for (const session of sessions) {
    byId.set(session.id, session);
  }

  for (const event of chronologicalEvents(events)) {
    if (event.type === "session.deleted") {
      byId.delete(event.sessionId);
      continue;
    }

    if (event.type === "session.created") {
      const created = eventSessionSnapshot(event);
      if (created && !byId.has(created.id)) {
        byId.set(created.id, created);
      }
    }

    if (event.type === "session.resumed") {
      const resumed = eventSessionSnapshot(event);
      if (resumed) {
        byId.set(resumed.id, resumed);
      }
    }

    const session = byId.get(event.sessionId);
    if (!session) {
      continue;
    }

    if (
      event.type === "session.status" &&
      isPiSessionStatus(event.payload.status)
    ) {
      byId.set(event.sessionId, {
        ...session,
        status: event.payload.status,
        updatedAt: event.createdAt,
      });
      continue;
    }

    if (event.type === "session.renamed") {
      const title = event.payload.title;
      if (typeof title === "string" && title.trim() !== "") {
        byId.set(event.sessionId, {
          ...session,
          title: title.trim(),
          updatedAt: event.createdAt,
        });
      }
      continue;
    }

    if (event.type === "session.error") {
      byId.set(event.sessionId, {
        ...session,
        status: "error",
        updatedAt: event.createdAt,
      });
    }
  }

  return Array.from(byId.values());
}

export function upsertPiSession(
  sessions: PiSession[],
  nextSession: PiSession,
): PiSession[] {
  const index = sessions.findIndex((session) => session.id === nextSession.id);
  if (index === -1) {
    return [nextSession, ...sessions];
  }

  const next = [...sessions];
  next[index] = nextSession;
  return next;
}
