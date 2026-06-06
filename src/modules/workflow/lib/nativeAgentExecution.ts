import { listen as tauriListen } from "@tauri-apps/api/event";
import {
  piNative,
  type WorkflowPiSessionPolicy,
} from "@/modules/pi/lib/native";
import {
  buildPiSessionTranscript,
  type PiPromptContext,
  type PiSessionCreateResult,
  type PiSessionEvent,
  type PiSessionSendResult,
  type PiSessionStopResult,
} from "@/modules/pi/lib/sessions";
import type { WorkflowAgentExecutor } from "./execution";

export type WorkflowPiAgentEventListener = (event: PiSessionEvent) => void;

export type WorkflowPiAgentEventSource = (
  listener: WorkflowPiAgentEventListener,
) => Promise<() => void> | (() => void);

export type WorkflowPiAgentApi = {
  sessionCreate: (
    title?: string,
    cwd?: string | null,
    policy?: WorkflowPiSessionPolicy,
  ) => Promise<PiSessionCreateResult>;
  sessionSend: (
    sessionId: string,
    prompt: string,
    context?: PiPromptContext | null,
  ) => Promise<PiSessionSendResult>;
  sessionStop: (sessionId: string) => Promise<PiSessionStopResult>;
};

export type WorkflowPiAgentExecutorOptions = {
  pi?: WorkflowPiAgentApi;
  listen?: WorkflowPiAgentEventSource;
};

const workflowPiNativeApi: WorkflowPiAgentApi = {
  sessionCreate: (title, cwd, policy) =>
    piNative.workflowSessionCreate(title, cwd, policy),
  sessionSend: (...args) => piNative.sessionSend(...args),
  sessionStop: (...args) => piNative.sessionStop(...args),
};

export const tauriWorkflowPiAgentExecutor = createWorkflowPiAgentExecutor();

export function createWorkflowPiAgentExecutor(
  options: WorkflowPiAgentExecutorOptions = {},
): WorkflowAgentExecutor {
  const pi = options.pi ?? workflowPiNativeApi;
  const listen = options.listen ?? listenToTauriPiSessionEvents;

  return async (input) => {
    throwIfAborted(input.signal);

    let sessionId: string | null = null;
    let stopPromise: Promise<void> | null = null;
    const events: PiSessionEvent[] = [];
    const stopSession = async () => {
      if (!sessionId) return;
      stopPromise ??= pi.sessionStop(sessionId).then(() => undefined);
      await stopPromise;
    };
    const abortListener = () => {
      void stopSession();
    };

    input.signal?.addEventListener("abort", abortListener, { once: true });
    const unlisten = await listen((event) => {
      if (event.sessionId !== sessionId) return;
      events.push(event);
      const delta = outputDeltaText(event);
      if (delta !== null) input.reportOutput(delta);
    });

    try {
      const created = await pi.sessionCreate(
        input.node.title,
        input.cwd ?? null,
        workflowAgentPolicy(input),
      );
      sessionId = created.session.id;
      events.push(...created.events);
      throwIfAborted(input.signal);

      const result = await pi.sessionSend(sessionId, input.prompt, null);
      events.push(...result.events);
      if (input.signal?.aborted) {
        await stopSession();
        throw abortError();
      }

      return {
        text: finalAssistantText(events),
        sessionId,
        eventIds: uniqueEventIds(events),
      };
    } catch (error) {
      if (input.signal?.aborted) {
        await stopSession();
        throw abortError();
      }
      throw error;
    } finally {
      input.signal?.removeEventListener("abort", abortListener);
      unlisten();
    }
  };
}

function workflowAgentPolicy(
  input: Parameters<WorkflowAgentExecutor>[0],
): WorkflowPiSessionPolicy {
  return {
    approved: true,
    documentId: input.document.id,
    nodeId: input.node.id,
    toolName:
      input.node.type === "browserAutomation"
        ? "workflow.browser_automation"
        : "workflow.agent_prompt",
  };
}

function listenToTauriPiSessionEvents(
  listener: WorkflowPiAgentEventListener,
): Promise<() => void> {
  return tauriListen<PiSessionEvent>("pi:session-event", (event) => {
    listener(event.payload);
  });
}

function outputDeltaText(event: PiSessionEvent): string | null {
  if (event.type !== "session.output.delta") return null;
  return typeof event.payload.text === "string" ? event.payload.text : null;
}

function finalAssistantText(events: PiSessionEvent[]): string {
  const transcript = buildPiSessionTranscript(events);
  const assistant = [...transcript]
    .reverse()
    .find((item) => item.kind === "assistant" && item.text);
  if (assistant?.text) return assistant.text;

  const deltaText = events
    .map(outputDeltaText)
    .filter((text): text is string => text !== null)
    .join("");
  return deltaText.trim().length > 0 ? deltaText : "Agent produced no output";
}

function uniqueEventIds(events: PiSessionEvent[]): string[] {
  return Array.from(new Map(events.map((event) => [event.id, event])).keys());
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Execution cancelled", "AbortError");
  }
  const error = new Error("Execution cancelled");
  error.name = "AbortError";
  return error;
}
