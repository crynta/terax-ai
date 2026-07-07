import { useMemo, useRef, useState } from "react";
import type { PiProviderRuntimeConfig } from "@/modules/pi/lib/provider";
import type {
  PiPromptContext,
  PiSessionCreateResult,
  PiSessionEvent,
  PiSessionSendResult,
  PiSessionStopResult,
} from "@/modules/pi/lib/sessions";
import { getOrCreateChat, useChatStore } from "../store/chatStore";

export const PI_COMPOSER_RUNTIME_STORAGE_KEY = "terax.pi.composerRuntime";

export type ComposerMessagePart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; url: string; filename?: string };

export type ComposerRuntime = {
  readonly sessionId: string | null;
  readonly canSend: boolean;
  readonly isBusy: boolean;
  send: (parts: ComposerMessagePart[]) => void | Promise<void>;
  stop: () => void | Promise<void>;
};

export type PiComposerRuntimeContext = {
  workspaceRoot: string | null;
  activeCwd: string | null;
  activeFile: string | null;
  activeTerminalPrivate: boolean;
};

export type PiComposerSessionState = {
  sessionId: string | null;
};

export type PiComposerRuntimeDeps = {
  createSession: (
    title?: string,
    cwd?: string | null,
    providerConfig?: PiProviderRuntimeConfig | null,
  ) => Promise<PiSessionCreateResult>;
  publishEvents: (events: PiSessionEvent[]) => Promise<void> | void;
  sendSession: (
    sessionId: string,
    promptText: string,
    context?: PiPromptContext | null,
  ) => Promise<PiSessionSendResult>;
  stopSession: (sessionId: string) => Promise<PiSessionStopResult>;
};

export type PiComposerRuntimeOptions = {
  deps?: PiComposerRuntimeDeps;
  enabled: boolean;
  context: PiComposerRuntimeContext;
  providerConfig: PiProviderRuntimeConfig | null;
  providerReady: boolean;
  selectedSessionId: string | null;
  onActivateSession?: (sessionId: string) => void;
  onSelectedSessionChange?: (sessionId: string) => void;
};

export type CreatePiComposerRuntimeOptions = Omit<
  PiComposerRuntimeOptions,
  "deps" | "enabled"
> & {
  deps: PiComposerRuntimeDeps;
  state: PiComposerSessionState;
};

export type UseComposerRuntimeOptions = {
  pi?: PiComposerRuntimeOptions;
};

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isPiComposerRuntimeEnabled(
  storage: Pick<Storage, "getItem"> | null = browserStorage(),
): boolean {
  try {
    const value = storage?.getItem(PI_COMPOSER_RUNTIME_STORAGE_KEY);
    return value === "pi" || value === "1" || value === "true";
  } catch {
    return false;
  }
}

function composePiPromptText(parts: ComposerMessagePart[]): string | null {
  const text = parts
    .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
    .filter(Boolean)
    .join("\n\n");
  return text.length > 0 ? text : null;
}

function toPiPromptContext(context: PiComposerRuntimeContext): PiPromptContext {
  return {
    workspaceRoot: context.workspaceRoot,
    activeTerminalCwd: context.activeCwd,
    activeFile: context.activeFile,
    activeTerminalPrivate: context.activeTerminalPrivate,
  };
}

function composerSessionCwd(context: PiComposerRuntimeContext): string {
  return context.activeCwd ?? context.workspaceRoot ?? "/";
}

async function createDefaultPiSession(
  title?: string,
  cwd?: string | null,
  providerConfig?: PiProviderRuntimeConfig | null,
): Promise<PiSessionCreateResult> {
  const { webviewSessionCreate } = await import(
    "@/modules/pi/lib/webview-session"
  );
  return webviewSessionCreate(title, cwd, providerConfig);
}

async function publishPiEvents(events: PiSessionEvent[]): Promise<void> {
  if (events.length === 0) return;
  const { emit } = await import("@tauri-apps/api/event");
  await Promise.all(
    events.map((event) =>
      emit("pi:session-event", event).catch(() => undefined),
    ),
  );
}

async function sendDefaultPiSession(
  sessionId: string,
  promptText: string,
  context?: PiPromptContext | null,
): Promise<PiSessionSendResult> {
  const { webviewSessionSend } = await import(
    "@/modules/pi/lib/webview-session"
  );
  return webviewSessionSend(sessionId, promptText, context);
}

async function stopDefaultPiSession(
  sessionId: string,
): Promise<PiSessionStopResult> {
  const { webviewSessionStop } = await import(
    "@/modules/pi/lib/webview-session"
  );
  return webviewSessionStop(sessionId);
}

const DEFAULT_PI_COMPOSER_DEPS: PiComposerRuntimeDeps = {
  createSession: createDefaultPiSession,
  publishEvents: publishPiEvents,
  sendSession: sendDefaultPiSession,
  stopSession: stopDefaultPiSession,
};

export function createPiComposerRuntime({
  deps,
  state,
  context,
  providerConfig,
  providerReady,
  selectedSessionId,
  onActivateSession,
  onSelectedSessionChange,
}: CreatePiComposerRuntimeOptions): ComposerRuntime {
  const activeSessionId = () => selectedSessionId ?? state.sessionId;
  const promptContext = toPiPromptContext(context);

  const ensureSession = async (): Promise<string | null> => {
    const currentSessionId = activeSessionId();
    if (currentSessionId) return currentSessionId;
    if (!providerReady) return null;
    const result = await deps.createSession(
      "Quick ask",
      composerSessionCwd(context),
      providerConfig,
    );
    state.sessionId = result.session.id;
    onSelectedSessionChange?.(result.session.id);
    await deps.publishEvents(result.events);
    return result.session.id;
  };

  return {
    sessionId: activeSessionId(),
    canSend: providerReady,
    isBusy: false,
    send: async (parts) => {
      if (!providerReady) return;
      const promptText = composePiPromptText(parts);
      if (!promptText) return;
      const sessionId = await ensureSession();
      if (!sessionId) return;
      onActivateSession?.(sessionId);
      await deps.sendSession(sessionId, promptText, promptContext);
    },
    stop: async () => {
      const sessionId = selectedSessionId ?? state.sessionId;
      if (!sessionId) return;
      await deps.stopSession(sessionId);
    },
  };
}

export function useChatComposerRuntime(): ComposerRuntime {
  const sessionId = useChatStore((s) => s.activeSessionId);
  const status = useChatStore((s) => s.agentMeta.status);
  const isBusy = status === "thinking" || status === "streaming";

  return useMemo<ComposerRuntime>(
    () => ({
      sessionId,
      canSend: sessionId !== null,
      isBusy,
      send: (parts) => {
        if (!sessionId) return;
        const chat = getOrCreateChat(sessionId);
        void chat.sendMessage({ role: "user", parts } as Parameters<
          typeof chat.sendMessage
        >[0]);
        const store = useChatStore.getState();
        store.patchAgentMeta({ hitStepCap: false, compactionNotice: null });
        if (!store.mini.open) store.openMini();
      },
      stop: () => {
        if (!sessionId) return;
        void getOrCreateChat(sessionId).stop();
      },
    }),
    [isBusy, sessionId],
  );
}

function usePiComposerRuntime(
  options: PiComposerRuntimeOptions | undefined,
): ComposerRuntime {
  const stateRef = useRef<PiComposerSessionState>({ sessionId: null });
  const [isBusy, setIsBusy] = useState(false);
  const deps = options?.deps ?? DEFAULT_PI_COMPOSER_DEPS;

  return useMemo<ComposerRuntime>(() => {
    if (!options?.enabled) {
      return {
        sessionId: null,
        canSend: false,
        isBusy: false,
        send: () => undefined,
        stop: () => undefined,
      };
    }

    const runtime = createPiComposerRuntime({
      deps,
      state: stateRef.current,
      context: options.context,
      providerConfig: options.providerConfig,
      providerReady: options.providerReady,
      selectedSessionId: options.selectedSessionId,
      onActivateSession: options.onActivateSession,
      onSelectedSessionChange: options.onSelectedSessionChange,
    });

    return {
      ...runtime,
      isBusy,
      send: async (parts) => {
        setIsBusy(true);
        try {
          await runtime.send(parts);
        } finally {
          setIsBusy(false);
        }
      },
      stop: async () => {
        await runtime.stop();
        setIsBusy(false);
      },
    };
  }, [deps, isBusy, options]);
}

export function useComposerRuntime(
  options?: UseComposerRuntimeOptions,
): ComposerRuntime {
  const chatRuntime = useChatComposerRuntime();
  const piRuntime = usePiComposerRuntime(options?.pi);
  return options?.pi?.enabled ? piRuntime : chatRuntime;
}
