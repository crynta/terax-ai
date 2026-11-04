import type {
  AgentHookEvent,
  AgentModelEvent,
  AgentSignalEvent,
  HookEventKind,
  PermissionInfo,
  SubagentInfo,
  ToolInfo,
} from "@/modules/agents/model";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const AGENT_EVENT = "terax:agent-event";
export const TERMINAL_NOTIFICATION_EVENT = "terax:terminal-notification";

const KINDS: ReadonlySet<string> = new Set<HookEventKind>([
  "session-start",
  "prompt",
  "tool-start",
  "tool-end",
  "permission-request",
  "permission-resolved",
  "notification",
  "stop",
  "stop-failure",
  "interrupt",
  "subagent-start",
  "subagent-stop",
  "session-end",
]);

type Dict = Record<string, unknown>;

function dict(value: unknown): Dict | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function id(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function parseTool(value: unknown): ToolInfo | undefined {
  const tool = dict(value);
  const name = text(tool?.name);
  if (!tool || name === undefined) return undefined;
  return {
    name,
    inputPreview: text(tool.inputPreview) ?? "",
    id: text(tool.id),
    error: tool.error === true ? true : undefined,
  };
}

function parsePermission(value: unknown): PermissionInfo | undefined {
  const permission = dict(value);
  const tool = text(permission?.tool);
  if (!permission || tool === undefined) return undefined;
  const suggestions = Array.isArray(permission.suggestions)
    ? permission.suggestions
        .map((entry) => text(dict(entry)?.label))
        .filter((label): label is string => label !== undefined)
        .map((label) => ({ label }))
    : undefined;
  return {
    requestId: text(permission.requestId),
    tool,
    inputPreview: text(permission.inputPreview) ?? "",
    suggestions,
    outcome: text(permission.outcome),
  };
}

function parseSubagent(value: unknown): SubagentInfo | undefined {
  const subagent = dict(value);
  const subagentId = text(subagent?.id);
  if (!subagent || subagentId === undefined) return undefined;
  const state = subagent.state === "done" ? "done" : "running";
  return { id: subagentId, type: text(subagent.type) ?? "agent", state };
}

/** Validates a native `terax:agent-event` payload; null when malformed. */
export function parseAgentHookEvent(payload: unknown): AgentHookEvent | null {
  const raw = dict(payload);
  if (!raw) return null;
  const paneId = id(raw.paneId);
  const ptyId = id(raw.ptyId);
  const agent = text(raw.agent);
  const kind = text(raw.kind);
  const at =
    typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : null;
  if (
    paneId === null ||
    ptyId === null ||
    agent === undefined ||
    kind === undefined ||
    !KINDS.has(kind) ||
    at === null
  ) {
    return null;
  }
  return {
    paneId,
    ptyId,
    agent,
    kind: kind as HookEventKind,
    sessionId: text(raw.sessionId),
    transcriptPath: text(raw.transcriptPath),
    cwd: text(raw.cwd),
    message: text(raw.message),
    notificationType: text(raw.notificationType),
    reason: text(raw.reason),
    tool: parseTool(raw.tool),
    permission: parsePermission(raw.permission),
    subagent: parseSubagent(raw.subagent),
    at,
  };
}

export type TerminalNotificationKind = "bell" | "osc9" | "osc99" | "osc777";

export type TerminalNotification = {
  ptyId: number;
  title?: string;
  body: string;
  kind: TerminalNotificationKind;
};

const NOTIFICATION_KINDS: ReadonlySet<string> = new Set([
  "bell",
  "osc9",
  "osc99",
  "osc777",
]);

export function parseTerminalNotification(
  payload: unknown,
): TerminalNotification | null {
  const raw = dict(payload);
  const ptyId = id(raw?.ptyId);
  const kind = text(raw?.kind);
  if (!raw || ptyId === null || kind === undefined) return null;
  if (!NOTIFICATION_KINDS.has(kind)) return null;
  return {
    ptyId,
    title: text(raw.title),
    body: text(raw.body) ?? "",
    kind: kind as TerminalNotificationKind,
  };
}

type Fanout<T> = {
  subscribe: (handler: (value: T) => void) => () => void;
  /** Resolves once the native listener is attached (or failed to attach). */
  ready: () => Promise<void>;
};

/**
 * One native listener per event, attached with the first subscriber and
 * released with the last, so unused features hold no IPC subscription.
 */
function fanout<T>(
  eventName: string,
  parse: (payload: unknown) => T | null,
): Fanout<T> {
  const handlers = new Set<(value: T) => void>();
  let attached: Promise<UnlistenFn> | null = null;

  const attach = () => {
    const pending = listen<unknown>(eventName, (event) => {
      const value = parse(event.payload);
      if (value === null) return;
      for (const handler of handlers) {
        try {
          handler(value);
        } catch (error) {
          console.error(`[terax] ${eventName} handler failed:`, error);
        }
      }
    });
    attached = pending;
    pending.catch((error) => {
      if (attached === pending) attached = null;
      console.error(`[terax] could not listen for ${eventName}:`, error);
    });
  };

  return {
    subscribe(handler) {
      handlers.add(handler);
      if (!attached) attach();
      return () => {
        handlers.delete(handler);
        if (handlers.size > 0 || !attached) return;
        const release = attached;
        attached = null;
        void release.then((unlisten) => unlisten()).catch(() => undefined);
      };
    },
    ready: () =>
      attached
        ? attached.then(
            () => undefined,
            () => undefined,
          )
        : Promise.resolve(),
  };
}

const agentEvents = fanout(AGENT_EVENT, parseAgentHookEvent);
const terminalNotifications = fanout(
  TERMINAL_NOTIFICATION_EVENT,
  parseTerminalNotification,
);

export const subscribeAgentEvents = agentEvents.subscribe;
export const agentEventsReady = agentEvents.ready;
export const subscribeTerminalNotifications = terminalNotifications.subscribe;

export function hookEventToModelEvent(event: AgentHookEvent): AgentModelEvent {
  return { type: "hook", event };
}

/** Adapts a legacy `terax:agent-signal` (process and OSC state) for the model. */
export function signalToModelEvent(
  signal: AgentSignalEvent,
  at: number = Date.now(),
): AgentModelEvent {
  return { type: "signal", signal, at };
}
