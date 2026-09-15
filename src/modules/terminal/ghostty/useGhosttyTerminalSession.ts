import { loadSessionRenderer } from "@/modules/terminal/ghostty/loadSessionRenderer";
import {
  ensureGhosttyBlocks,
  ghosttyBlocks,
  disposeGhosttyBlocks,
} from "@/modules/terminal/ghostty/ghosttyBlockSessions";
import { initializeSessionGeneration as startSessionInitialization } from "@/modules/terminal/ghostty/sessionInitialization";
import { replaceSessionSurface } from "@/modules/terminal/ghostty/replaceSessionSurface";
import { openExternalUrl } from "@/lib/external-link";
import { ensureMonoFontsLoaded, resolveFontFamily } from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { TerminalBackendKind } from "@/modules/terminal/backend/contracts";
import { PtyResizeScheduler } from "@/modules/terminal/lib/ptyResizeScheduler";
import { subscribeTerminalResizeInteraction } from "@/modules/terminal/lib/terminalResizeInteraction";
import { useTerminalFont } from "@/modules/terminal/lib/useTerminalFont";
import type { TerminalSearchController } from "@/modules/terminal/search/TerminalSearchController";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openPty, type PtySession } from "../lib/pty-bridge";
import { writeTerminalClipboard } from "../lib/terminalClipboard";
import { LatestClipboardWrite } from "@/modules/terminal/lib/LatestClipboardWrite";
import { GhosttySemanticEventRouter } from "./core/GhosttySemanticEventRouter";
import { getGhosttyCoreRuntime } from "./GhosttyCoreRuntime";
import type { GhosttyTerminalModelApi } from "./GhosttyTerminalModel";
import {
  measureTerminalFont,
  readTerminalGpuTheme,
  rgbToInt,
  type TerminalFontSpec,
} from "./gpu/terminalVisuals";
import { getWebGpuTerminalRuntime } from "./gpu/WebGpuTerminalRuntime";
import { WebGpuTerminalSurface } from "./gpu/WebGpuTerminalSurface";
import { GhosttyInputController } from "./input/GhosttyInputController";
import { encodeTerminalSubmission } from "./input/terminalInputEncoding";
import type {
  WebGlTerminalSurface,
  WebGlTerminalSurfaceOptions,
} from "./webgl/WebGlTerminalSurface";

type GhosttyBackend = Extract<TerminalBackendKind, `ghostty-${string}`>;
type GhosttySurface = WebGpuTerminalSurface | WebGlTerminalSurface;
type GhosttySurfaceBaseOptions = Omit<WebGlTerminalSurfaceOptions, "onError">;
type GhosttySessionFailure = {
  kind: "startup" | "renderer";
  message: string;
};

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_PENDING_INPUT_BYTES = 256 * 1024;
const MAX_WRITE_BATCH_BYTES = 64 * 1024;

type Callbacks = {
  onModel?: (model: GhosttyTerminalModelApi | null) => void;
  onError?: (error: GhosttySessionFailure | null) => void;
  onSearchReady?: (search: TerminalSearchController) => void;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
};

type GhosttySession = {
  readonly leafId: number;
  readonly backend: GhosttyBackend;
  initialCwd: string | undefined;
  lastCwd: string | null;
  model: GhosttyTerminalModelApi | null;
  surface: GhosttySurface | null;
  surfaceOptions: GhosttySurfaceBaseOptions | null;
  input: GhosttyInputController | null;
  pty: PtySession | null;
  ptyResize: PtyResizeScheduler;
  unsubscribeResizeInteraction: () => void;
  writer: BoundedPtyWriter;
  container: HTMLDivElement | null;
  callbacks: Callbacks;
  visible: boolean;
  focused: boolean;
  startupError: string | null;
  rendererError: string | null;
  shellExited: boolean;
  disposed: boolean;
  generation: number;
  initializing: Promise<void> | null;
  startup: GhosttyStartupTimings;
  font: TerminalFontSpec;
};

type GhosttyStartupTimings = {
  startedAt: number;
  fontsReadyMs: number | null;
  coreReadyMs: number | null;
  gpuReadyMs: number | null;
  modelReadyMs: number | null;
  surfaceReadyMs: number | null;
  ptyReadyMs: number | null;
  firstOutputMs: number | null;
  firstFrameMs: number | null;
  firstPromptMs: number | null;
};

const sessions = new Map<number, GhosttySession>();
const textEncoder = new TextEncoder();
const oscClipboard = new LatestClipboardWrite(writeTerminalClipboard);

type Options = {
  leafId: number;
  backend: GhosttyBackend;
  container: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  focused: boolean;
  initialCwd?: string;
  blocks?: boolean;
  onExit?: (code: number) => void;
  onCwd?: (cwd: string) => void;
  onSearchReady?: (search: TerminalSearchController) => void;
};

export function useGhosttyTerminalSession({
  leafId,
  backend,
  container,
  visible,
  focused,
  initialCwd,
  blocks = false,
  onSearchReady,
  onExit,
  onCwd,
}: Options) {
  const [model, setModel] = useState<GhosttyTerminalModelApi | null>(null);
  const [error, setError] = useState<GhosttySessionFailure | null>(null);
  const { fontFamily, fontSize, fontWeight } = useTerminalFont();
  const letterSpacing = usePreferencesStore(
    (state) => state.terminalLetterSpacing,
  );
  const zoomLevel = usePreferencesStore((state) => state.zoomLevel);
  const font = useMemo<TerminalFontSpec>(
    () => ({
      family: resolveFontFamily(fontFamily),
      size: Math.max(4, Math.round(fontSize * zoomLevel)),
      lineHeight: 1.2,
      letterSpacing,
      weight: fontWeight,
    }),
    [fontFamily, fontSize, fontWeight, letterSpacing, zoomLevel],
  );
  const fontRef = useRef(font);
  fontRef.current = font;
  const callbackRef = useRef({ onSearchReady, onExit, onCwd });
  callbackRef.current = { onSearchReady, onExit, onCwd };
  const initialCwdRef = useRef(initialCwd);

  useEffect(() => {
    const session = ensureSession(
      leafId,
      backend,
      initialCwdRef.current,
      fontRef.current,
    );
    if (blocks) ensureGhosttyBlocks(leafId);
    const node = container.current;
    session.container = node;
    setModel(session.model);
    session.callbacks = {
      onModel: setModel,
      onError: setError,
      onSearchReady: (search) => callbackRef.current.onSearchReady?.(search),
      onExit: (code) => callbackRef.current.onExit?.(code),
      onCwd: (cwd) => callbackRef.current.onCwd?.(cwd),
    };
    setError(sessionFailure(session));
    if (session.surface) {
      session.callbacks.onSearchReady?.(session.surface.searchController());
    }
    if (session.lastCwd !== null) session.callbacks.onCwd?.(session.lastCwd);
    void initializeSession(session);
    return () => {
      if (session.container === node) {
        session.surface?.detach();
        session.container = null;
        session.callbacks = {};
      }
    };
  }, [leafId, backend, container, blocks]);

  useEffect(() => {
    const session = sessions.get(leafId);
    if (!session || session.backend !== backend) return;
    void updateSessionFont(session, font);
  }, [leafId, backend, font]);

  useEffect(() => {
    const session = ensureSession(leafId, backend, initialCwdRef.current);
    session.visible = visible;
    session.focused = focused;
    ghosttyBlocks(leafId)?.setVisible(visible);
    const surface = session.surface;
    if (!surface || session.rendererError) return;
    if (visible && session.container) {
      try {
        attachGhosttySurface(session, surface);
      } catch (error) {
        reportRendererFailure(session, toError(error));
      }
    } else {
      surface.setVisible(false);
      surface.detach();
    }
  }, [leafId, backend, visible, focused]);

  const cursorBlink = usePreferencesStore((state) => state.terminalCursorBlink);
  const cursorStyle = usePreferencesStore((state) => state.terminalCursorStyle);
  useEffect(() => {
    const session = sessions.get(leafId);
    session?.surface?.setCursorOptions(cursorBlink, cursorStyle);
    if (session?.surfaceOptions) {
      session.surfaceOptions = {
        ...session.surfaceOptions,
        cursorBlink,
        cursorStyle,
      };
    }
  }, [leafId, cursorBlink, cursorStyle]);

  const write = useCallback(
    (data: string) => {
      writeToGhosttySession(leafId, data);
    },
    [leafId],
  );
  const focus = useCallback(() => focusGhosttySession(leafId), [leafId]);
  const getBuffer = useCallback(
    (maxLines = 200) => sessions.get(leafId)?.model?.readText(maxLines) ?? null,
    [leafId],
  );
  const getSelection = useCallback(
    () => sessions.get(leafId)?.surface?.getSelection() ?? null,
    [leafId],
  );
  const applyTheme = useCallback(() => {
    const session = sessions.get(leafId);
    if (!session?.model || !session.surface) return;
    const theme = readTerminalGpuTheme();
    session.model.setColors(
      rgbToInt(theme.foreground),
      rgbToInt(theme.background),
      rgbToInt(theme.cursor),
      theme.palette.map(rgbToInt),
    );
    session.surface.setTheme(theme);
    if (session.surfaceOptions)
      session.surfaceOptions = { ...session.surfaceOptions, theme };
  }, [leafId]);

  const retry = useCallback(() => {
    const session = sessions.get(leafId);
    if (session?.rendererError) {
      retryGhosttyRenderer(session);
      return;
    }
    void respawnGhosttySession(leafId).catch((error: unknown) =>
      setError({ kind: "startup", message: toError(error).message }),
    );
  }, [leafId]);

  return useMemo(
    () => ({
      error,
      model,
      retry,
      write,
      focus,
      getBuffer,
      getSelection,
      applyTheme,
    }),
    [write, focus, getBuffer, getSelection, applyTheme, error, retry, model],
  );
}

export function hasGhosttySession(leafId: number): boolean {
  return sessions.has(leafId);
}

export function writeToGhosttySession(leafId: number, data: string): boolean {
  const session = sessions.get(leafId);
  if (!session || session.shellExited || session.disposed) return false;
  return session.writer.enqueue(textEncoder.encode(data));
}

export function submitToGhosttySession(leafId: number, text: string): boolean {
  const session = sessions.get(leafId);
  if (!session || session.shellExited || session.disposed) return false;
  const data = encodeTerminalSubmission(
    text,
    session.model?.modes().bracketedPaste ?? false,
  );
  const accepted = session.writer.enqueue(textEncoder.encode(data));
  if (accepted) {
    const blocks = ghosttyBlocks(leafId);
    if (blocks) {
      blocks.everSubmitted = true;
      blocks.controller?.submitted(text);
      blocks.changed();
    }
  }
  return accepted;
}

export function interruptGhosttySession(leafId: number): boolean {
  const session = sessions.get(leafId);
  return session?.writer.enqueue(Uint8Array.of(3)) ?? false;
}

export function clearGhosttySession(leafId: number): boolean {
  const session = sessions.get(leafId);
  if (!session?.model || session.disposed) return false;
  ghosttyBlocks(leafId)?.controller?.clear();
  session.model.clear();
  focusGhosttySession(leafId);
  return true;
}

export function pasteIntoGhosttySession(leafId: number, text: string): boolean {
  const blocks = ghosttyBlocks(leafId);
  if (blocks?.getMode() === "prompt" && blocks.paste) {
    blocks.paste(text);
    return true;
  }
  const session = sessions.get(leafId);
  if (!session?.input) return false;
  session.input.paste(text);
  session.surface?.focus();
  return true;
}

export function ghosttySelectionForLeaf(leafId: number): string | null {
  return sessions.get(leafId)?.surface?.getSelection() ?? null;
}

export function ghosttyCwdForLeaf(leafId: number): string | null {
  return sessions.get(leafId)?.lastCwd ?? null;
}

export function ghosttyFocusedLeaf(): number | null {
  for (const [leafId, session] of sessions) {
    if (session.visible && session.focused) return leafId;
  }
  return null;
}

export async function whenGhosttySessionReady(
  leafId: number,
): Promise<boolean> {
  const session = sessions.get(leafId);
  if (!session) return false;
  await session.initializing;
  return (
    !!session.pty &&
    !!session.model &&
    !session.startupError &&
    !session.disposed
  );
}

export function ghosttyPtyIdForLeaf(leafId: number): number | null {
  return sessions.get(leafId)?.pty?.id ?? null;
}

export function ghosttyLeafIdForPty(ptyId: number): number | null {
  for (const [leafId, session] of sessions) {
    if (session.pty?.id === ptyId) return leafId;
  }
  return null;
}

export async function ghosttyLeafHasForegroundProcess(
  leafId: number,
): Promise<boolean> {
  const session = sessions.get(leafId);
  if (!session?.pty || session.shellExited) return false;
  try {
    return await invoke<boolean>("pty_has_foreground_process", {
      id: session.pty.id,
    });
  } catch (error) {
    console.error(
      "[terax] Ghostty pty_has_foreground_process failed for leaf",
      leafId,
      error,
    );
    return false;
  }
}

export function disposeGhosttySession(leafId: number): boolean {
  const session = sessions.get(leafId);
  if (!session) return false;
  session.disposed = true;
  session.generation += 1;
  session.input?.dispose();
  session.surface?.dispose();
  disposeGhosttyBlocks(leafId);
  session.model?.dispose();
  session.unsubscribeResizeInteraction();
  session.ptyResize.reset();
  session.writer.dispose();
  void session.pty?.close();
  session.pty = null;
  sessions.delete(leafId);
  return true;
}

export async function respawnGhosttySession(
  leafId: number,
  cwd?: string,
): Promise<boolean> {
  const session = sessions.get(leafId);
  if (!session || session.disposed) return false;
  session.generation += 1;
  session.input?.dispose();
  session.input = null;
  session.surface?.dispose();
  session.surface = null;
  session.surfaceOptions = null;
  ghosttyBlocks(leafId)?.detach();
  session.model?.dispose();
  session.model = null;
  session.callbacks.onModel?.(null);
  session.ptyResize.reset();
  session.writer.detach();
  session.writer.clear();
  await session.pty?.close();
  session.pty = null;
  session.shellExited = false;
  session.lastCwd = null;
  session.initialCwd = cwd ?? session.initialCwd;
  session.startupError = null;
  session.rendererError = null;
  session.callbacks.onError?.(null);
  session.initializing = null;
  await initializeSession(session);
  return true;
}

export function ghosttySessionDiagnostics() {
  return [...sessions.values()].map((session) => ({
    leafId: session.leafId,
    blocks: ghosttyBlocks(session.leafId)?.controller?.diagnostics() ?? null,
    pty: session.pty?.id ?? null,
    visible: session.visible,
    focused: session.focused,
    shellExited: session.shellExited,
    startupError: session.startupError,
    rendererError: session.rendererError,
    model: session.model?.diagnostics() ?? null,
    surface: session.surface?.diagnostics() ?? null,
    ptyResize: session.ptyResize.diagnostics(),
    pendingInputBytes: session.writer.pendingBytes,
    startup: startupDiagnostics(session.startup),
  }));
}

export function ghosttySessionResourceTotals() {
  let modelCellCapacity = 0;
  let modelRowCapacity = 0;
  let scrollbackLines = 0;
  let surfaceCpuBytes = 0;
  let surfaceGpuBufferBytes = 0;
  let canvasColorBytes = 0;
  let estimatedSwapchainBytes = 0;

  for (const session of sessions.values()) {
    const model = session.model?.diagnostics();
    modelCellCapacity += model?.bridgeCellCapacity ?? 0;
    modelRowCapacity += model?.bridgeRowCapacity ?? 0;
    scrollbackLines += model?.scrollbackLines ?? 0;
    const surface = session.surface;
    if (!surface) continue;
    if (surface.backend === "ghostty-webgpu") {
      const stats = surface.diagnostics();
      surfaceCpuBytes += stats.cpuBufferBytes;
      surfaceGpuBufferBytes += stats.gpuBufferBytes;
      canvasColorBytes += stats.canvasColorBytes;
      estimatedSwapchainBytes += stats.estimatedSwapchainBytes;
      continue;
    }
    const stats = surface.diagnostics();
    const renderer = stats.renderer;
    if (!renderer) continue;
    surfaceCpuBytes += renderer.cpuBufferBytes;
    surfaceGpuBufferBytes += renderer.gpuBufferBytes;
    canvasColorBytes += renderer.canvasColorBytes;
  }

  return {
    modelCellCapacity,
    modelRowCapacity,
    scrollbackLines,
    surfaceCpuBytes,
    surfaceGpuBufferBytes,
    canvasColorBytes,
    estimatedSwapchainBytes,
  };
}

function ensureSession(
  leafId: number,
  backend: GhosttyBackend,
  initialCwd?: string,
  font?: TerminalFontSpec,
): GhosttySession {
  const existing = sessions.get(leafId);
  if (existing) {
    if (existing.backend !== backend) {
      throw new Error(
        `Ghostty backend changed for live leaf ${leafId}; reload is required`,
      );
    }
    return existing;
  }
  const ptyResize = new PtyResizeScheduler((cols, rows) => {
    void sessions.get(leafId)?.pty?.resize(cols, rows);
  });
  const unsubscribeResizeInteraction = subscribeTerminalResizeInteraction(
    (active) => {
      if (active) ptyResize.suspend();
      else ptyResize.resume();
    },
  );
  const session: GhosttySession = {
    leafId,
    backend,
    initialCwd,
    lastCwd: null,
    model: null,
    surface: null,
    surfaceOptions: null,
    input: null,
    pty: null,
    ptyResize,
    unsubscribeResizeInteraction,
    writer: new BoundedPtyWriter((error) => {
      console.error("[terax] Ghostty PTY write failed:", error);
    }),
    container: null,
    callbacks: {},
    visible: false,
    focused: false,
    startupError: null,
    rendererError: null,
    shellExited: false,
    disposed: false,
    generation: 0,
    initializing: null,
    startup: createStartupTimings(),
    font:
      font ??
      ({
        family: "monospace",
        size: 14,
        lineHeight: 1.2,
        letterSpacing: 0,
        weight: "400",
      } satisfies TerminalFontSpec),
  };
  sessions.set(leafId, session);
  return session;
}

function initializeSession(session: GhosttySession): Promise<void> {
  return startSessionInitialization(
    session,
    (generation) => initializeSessionGeneration(session, generation),
    (error) => {
      session.shellExited = session.pty === null;
      if (!session.pty) {
        session.input?.dispose();
        session.input = null;
        session.surface?.dispose();
        session.surface = null;
        session.surfaceOptions = null;
        ghosttyBlocks(session.leafId)?.detach();
        session.model?.dispose();
        session.model = null;
        session.writer.clear();
        session.ptyResize.reset();
      }
      session.startupError = toError(error).message;
      console.error("[terax] Ghostty session initialization failed:", error);
      session.callbacks.onError?.(sessionFailure(session));
    },
  );
}

async function initializeSessionGeneration(
  session: GhosttySession,
  generation: number,
): Promise<void> {
  const preferences = usePreferencesStore.getState();
  const startup = createStartupTimings();
  session.startup = startup;
  const alive = () => !session.disposed && generation === session.generation;
  const mark = (key: keyof Omit<GhosttyStartupTimings, "startedAt">) => {
    if (alive() && startup[key] === null) {
      startup[key] = performance.now() - startup.startedAt;
    }
  };
  const theme = readTerminalGpuTheme();
  const coreRuntime = getGhosttyCoreRuntime();
  const metricsPromise = (async () => {
    await ensureMonoFontsLoaded();
    await document.fonts.ready;
    const initialFont = session.font;
    let metrics = await measureTerminalFont(initialFont);
    if (fontSpecKey(initialFont) !== fontSpecKey(session.font)) {
      metrics = await measureTerminalFont(session.font);
    }
    mark("fontsReadyMs");
    return metrics;
  })();
  const corePromise = coreRuntime.preload().then(() => mark("coreReadyMs"));
  const webGpuPreload = { error: null as Error | null };
  const rendererPromise =
    session.backend === "ghostty-webgpu"
      ? getWebGpuTerminalRuntime()
          .catch((error: unknown) => {
            webGpuPreload.error = toError(error);
          })
          .then(() => mark("gpuReadyMs"))
      : Promise.resolve().then(() => mark("gpuReadyMs"));
  const [metrics] = await Promise.all([
    metricsPromise,
    corePromise,
    rendererPromise,
  ]);
  if (!alive()) return;

  const semanticEvents = new GhosttySemanticEventRouter({
    onCwd: (cwd) => {
      if (session.lastCwd === cwd) return;
      session.lastCwd = cwd;
      session.callbacks.onCwd?.(cwd);
    },
    onClipboard: (text) => {
      oscClipboard.enqueue(text);
    },
    onOverflow: (dropped) => {
      console.warn(
        `[terax] Ghostty semantic event queue dropped ${dropped} event(s)`,
      );
    },
    onCommandState: (running) => {
      if (!running) mark("firstPromptMs");
    },
  });
  const model = await coreRuntime.createModel({
    leafId: session.leafId,
    backend: session.backend,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    config: {
      scrollbackLimit: preferences.terminalScrollback,
      fgColor: rgbToInt(theme.foreground),
      bgColor: rgbToInt(theme.background),
      cursorColor: rgbToInt(theme.cursor),
      palette: theme.palette.map(rgbToInt),
      cursorStyle: preferences.terminalCursorStyle,
      cursorBlink: preferences.terminalCursorBlink,
    },
    onReply: (bytes) => session.writer.enqueue(bytes),
    onEvent: (event) => {
      semanticEvents.handle(event);
      ghosttyBlocks(session.leafId)?.controller?.handle(
        event,
        session.lastCwd ?? session.initialCwd ?? "",
      );
    },
  });
  if (session.disposed || generation !== session.generation) {
    model.dispose();
    return;
  }
  mark("modelReadyMs");
  session.model = model;
  session.callbacks.onModel?.(model);
  await ghosttyBlocks(session.leafId)?.attach(model, () =>
    session.surface?.requestFrame(),
  );
  if (!alive()) {
    if (ghosttyBlocks(session.leafId)?.model === model)
      ghosttyBlocks(session.leafId)?.detach();
    model.dispose();
    return;
  }

  const surfaceBaseOptions: GhosttySurfaceBaseOptions = {
    model,
    metrics,
    theme,
    cursorBlink: preferences.terminalCursorBlink,
    cursorStyle: preferences.terminalCursorStyle,
    onResize: (cols: number, rows: number) => {
      session.ptyResize.schedule(cols, rows);
    },
    onFirstFrame: () => mark("firstFrameMs"),
    onFrame: () => ghosttyBlocks(session.leafId)?.present(),
    onRequestFocus: () => focusGhosttySession(session.leafId),
    onOpenLink: (uri: string) => {
      void openExternalUrl(uri, () => focusGhosttySession(session.leafId));
    },
  };
  session.surfaceOptions = surfaceBaseOptions;
  let webGpuFallbackStarted = false;
  const webGpuSurfaceOptions = {
    ...surfaceBaseOptions,
    onError: (error: Error) => {
      logSurfaceError("ghostty-webgpu", error);
      if (webGpuFallbackStarted) return;
      webGpuFallbackStarted = true;
      queueMicrotask(() => {
        fallbackWebGpuSurface(session, generation, surfaceBaseOptions, error);
      });
    },
  };
  let surface: GhosttySurface | null = null;
  if (session.backend === "ghostty-webgpu" && !webGpuPreload.error) {
    try {
      surface = await WebGpuTerminalSurface.create(webGpuSurfaceOptions);
    } catch (error) {
      webGpuPreload.error = toError(error);
    }
  }
  if (!surface) {
    surface = await loadSessionRenderer(
      session,
      generation,
      () => import("@/modules/terminal/ghostty/webgl/WebGlTerminalSurface"),
      (renderer) =>
        createWebGlFallbackSurface(
          session,
          generation,
          surfaceBaseOptions,
          renderer.WebGlTerminalSurface,
        ),
    );
    if (!surface) return;
  }
  if (webGpuPreload.error) {
    console.warn(
      "[terax] WebGPU initialization failed; preserving the Ghostty session with WebGL:",
      webGpuPreload.error.message,
    );
  }
  if (session.disposed || generation !== session.generation) {
    surface.dispose();
    model.dispose();
    return;
  }
  mark("surfaceReadyMs");
  session.surface = surface;
  session.input = createGhosttyInput(session, model, surface);

  if (session.visible && session.container) {
    try {
      attachGhosttySurface(session, surface);
    } catch (error) {
      if (surface.backend !== "ghostty-webgpu") throw error;
      try {
        surface = await replaceGhosttySurface(
          session,
          generation,
          surfaceBaseOptions,
        );
      } catch (fallbackError) {
        throw new Error(
          `WebGPU surface attachment failed (${toError(error).message}); WebGL fallback also failed (${toError(fallbackError).message})`,
        );
      }
      if (!surface) return;
      webGpuFallbackStarted = true;
      console.warn(
        "[terax] WebGPU surface attachment failed; preserved the Ghostty session with WebGL:",
        toError(error).message,
      );
    }
  }
  session.callbacks.onSearchReady?.(surface.searchController());

  const startCols = model.cols;
  const startRows = model.rows;
  const pty = await openPty(
    startCols,
    startRows,
    {
      onData: (bytes) => {
        if (!session.disposed && generation === session.generation) {
          mark("firstOutputMs");
          model.write(bytes);
          ghosttyBlocks(session.leafId)?.changed();
          applyBlockInputMode(session);
        }
      },
      onExit: (code) => {
        if (session.disposed || generation !== session.generation) return;
        session.shellExited = true;
        session.writer.detach();
        session.pty = null;
        session.callbacks.onExit?.(code);
      },
    },
    session.initialCwd,
    !!ghosttyBlocks(session.leafId),
    preferences.terminalShell || undefined,
    session.leafId,
  );
  if (session.disposed || generation !== session.generation) {
    await pty.close();
    return;
  }
  if (session.shellExited) {
    await pty.close();
    return;
  }
  mark("ptyReadyMs");
  session.pty = pty;
  session.writer.attach(pty);
  if (model.cols !== startCols || model.rows !== startRows) {
    session.ptyResize.schedule(model.cols, model.rows);
  }
}

function createGhosttyInput(
  session: GhosttySession,
  model: GhosttyTerminalModelApi,
  surface: GhosttySurface,
): GhosttyInputController {
  const insertPromptText = (text: string): boolean => {
    const blocks = ghosttyBlocks(session.leafId);
    if (blocks?.getMode() !== "prompt" || !blocks.paste) return false;
    blocks.paste(text);
    return true;
  };
  return new GhosttyInputController({
    model,
    input: surface.inputElement(),
    pointerTarget: surface.eventTarget(),
    cellSize: () => ({
      width: surface.cellSize().width,
      height: surface.cellSize().height,
    }),
    onData: (bytes) => {
      if (
        ghosttyBlocks(session.leafId)?.getMode() === "prompt" &&
        !(bytes.length === 1 && bytes[0] === 3)
      )
        return;
      session.writer.enqueue(bytes);
    },
    onKeyDown: (event) => {
      const blocks = ghosttyBlocks(session.leafId);
      return (
        blocks?.getMode() === "prompt" && (blocks.keyDown?.(event) ?? false)
      );
    },
    onText: insertPromptText,
    onPaste: insertPromptText,
    getSelection: () => surface.getSelection(),
    onCopy: () => {
      const text = surface.getSelection();
      if (!text) return false;
      void writeTerminalClipboard(text).catch(() => {});
      return true;
    },
  });
}

export function focusGhosttySession(leafId: number): void {
  const session = sessions.get(leafId);
  if (session) focusSessionSurface(session, session.surface);
}

function focusSessionSurface(
  session: GhosttySession,
  surface: GhosttySurface | null,
): void {
  const blocks = ghosttyBlocks(session.leafId);
  if (blocks?.getMode() === "prompt" && blocks.focus) blocks.focus();
  else surface?.focus();
}

function applyBlockInputMode(
  session: GhosttySession,
  surface = session.surface,
): void {
  const input = surface?.inputElement();
  const blocks = ghosttyBlocks(session.leafId);
  if (!input || !blocks) return;
  const prompt = blocks.getMode() === "prompt";
  const changed =
    input.getAttribute("data-terax-block-prompt") !== String(prompt);
  if (!changed) return;
  input.setAttribute("data-terax-block-prompt", String(prompt));
  surface?.setCursorEnabled(!prompt);
  if (session.visible && session.focused) focusSessionSurface(session, surface);
}

export function ghosttyBlockGeometry(
  leafId: number,
): { top: number; height: number } | null {
  const surface = sessions.get(leafId)?.surface;
  return surface
    ? {
        top: surface.eventTarget().getBoundingClientRect().top,
        height: surface.cellSize().height,
      }
    : null;
}

function attachGhosttySurface(
  session: GhosttySession,
  surface: GhosttySurface,
): void {
  if (!session.container) return;
  surface.attach(session.container);
  surface.setVisible(true);
  surface.setFocused(session.focused);
  applyBlockInputMode(session, surface);
  if (session.focused) focusSessionSurface(session, surface);
}

function createWebGlFallbackSurface(
  session: GhosttySession,
  generation: number,
  options: GhosttySurfaceBaseOptions,
  Surface: typeof WebGlTerminalSurface,
): WebGlTerminalSurface {
  const surface = new Surface({
    ...options,
    onError: (error) => {
      queueMicrotask(() => {
        if (
          !session.disposed &&
          generation === session.generation &&
          session.surface === surface
        ) {
          reportRendererFailure(session, error);
        }
      });
    },
  });
  return surface;
}

async function fallbackWebGpuSurface(
  session: GhosttySession,
  generation: number,
  options: GhosttySurfaceBaseOptions,
  cause: Error,
): Promise<void> {
  const failedSurface = session.surface;
  if (
    session.disposed ||
    generation !== session.generation ||
    failedSurface?.backend !== "ghostty-webgpu" ||
    !session.model
  ) {
    return;
  }

  try {
    if (!(await replaceGhosttySurface(session, generation, options))) return;
  } catch (error) {
    if (
      session.disposed ||
      session.generation !== generation ||
      session.surface !== failedSurface
    )
      return;
    reportRendererFailure(
      session,
      new Error(
        `WebGPU failed (${cause.message}); WebGL fallback failed (${toError(error).message})`,
      ),
    );
    return;
  }
  console.warn(
    "[terax] WebGPU renderer failed; preserved the live Ghostty model, PTY, and scrollback with WebGL:",
    cause.message,
  );
}

async function replaceGhosttySurface(
  session: GhosttySession,
  generation: number,
  options: GhosttySurfaceBaseOptions,
): Promise<GhosttySurface | null> {
  return loadSessionRenderer(
    session,
    generation,
    () => import("@/modules/terminal/ghostty/webgl/WebGlTerminalSurface"),
    (renderer) => {
      const currentOptions = session.surfaceOptions ?? options;
      const replacement = replaceSessionSurface(
        session,
        () =>
          createWebGlFallbackSurface(
            session,
            generation,
            currentOptions,
            renderer.WebGlTerminalSurface,
          ),
        (surface) => {
          if (session.visible && session.container)
            attachGhosttySurface(session, surface);
        },
        (surface) => createGhosttyInput(session, currentOptions.model, surface),
      );
      session.rendererError = null;
      session.callbacks.onError?.(sessionFailure(session));
      session.callbacks.onSearchReady?.(replacement.searchController());
      return replacement;
    },
  );
}

function reportRendererFailure(session: GhosttySession, error: Error): void {
  if (session.disposed) return;
  logSurfaceError(session.surface?.backend ?? session.backend, error);
  session.rendererError = error.message;
  session.surface?.setVisible(false);
  session.surface?.detach();
  session.callbacks.onError?.(sessionFailure(session));
}

async function retryGhosttyRenderer(session: GhosttySession): Promise<void> {
  if (session.disposed || !session.model || !session.surfaceOptions) return;
  const generation = session.generation;
  const failedSurface = session.surface;
  try {
    await replaceGhosttySurface(session, generation, session.surfaceOptions);
  } catch (error) {
    if (
      session.disposed ||
      session.generation !== generation ||
      session.surface !== failedSurface
    )
      return;
    reportRendererFailure(session, toError(error));
  }
}

function sessionFailure(session: GhosttySession): GhosttySessionFailure | null {
  if (session.startupError)
    return { kind: "startup", message: session.startupError };
  if (session.rendererError)
    return { kind: "renderer", message: session.rendererError };
  return null;
}

function logSurfaceError(backend: GhosttyBackend, error: Error): void {
  console.error(
    `[terax] ${backend} surface failed:`,
    error.message,
    error.stack ?? error,
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createStartupTimings(): GhosttyStartupTimings {
  return {
    startedAt: performance.now(),
    fontsReadyMs: null,
    coreReadyMs: null,
    gpuReadyMs: null,
    modelReadyMs: null,
    surfaceReadyMs: null,
    ptyReadyMs: null,
    firstOutputMs: null,
    firstFrameMs: null,
    firstPromptMs: null,
  };
}

function startupDiagnostics(startup: GhosttyStartupTimings) {
  return {
    fontsReadyMs: startup.fontsReadyMs,
    coreReadyMs: startup.coreReadyMs,
    gpuReadyMs: startup.gpuReadyMs,
    modelReadyMs: startup.modelReadyMs,
    surfaceReadyMs: startup.surfaceReadyMs,
    ptyReadyMs: startup.ptyReadyMs,
    firstOutputMs: startup.firstOutputMs,
    firstFrameMs: startup.firstFrameMs,
    firstPromptMs: startup.firstPromptMs,
  };
}

async function updateSessionFont(
  session: GhosttySession,
  font: TerminalFontSpec,
): Promise<void> {
  if (fontSpecKey(session.font) === fontSpecKey(font)) return;
  session.font = font;
  if (!session.surface || session.disposed) return;

  await ensureMonoFontsLoaded();
  await document.fonts.ready;
  const metrics = await measureTerminalFont(font);
  if (
    session.disposed ||
    !session.surface ||
    fontSpecKey(session.font) !== fontSpecKey(font)
  ) {
    return;
  }
  session.surface.setFontMetrics(metrics);
  ghosttyBlocks(session.leafId)?.changed();
  if (session.surfaceOptions)
    session.surfaceOptions = { ...session.surfaceOptions, metrics };
}

function fontSpecKey(font: TerminalFontSpec): string {
  return [
    font.family,
    font.size,
    font.lineHeight,
    font.letterSpacing,
    font.weight,
  ].join("|");
}

class BoundedPtyWriter {
  private readonly queue: Uint8Array[] = [];
  private pty: PtySession | null = null;
  private flushing = false;
  private disposed = false;
  pendingBytes = 0;

  constructor(private readonly onError: (error: unknown) => void) {}

  attach(pty: PtySession): void {
    if (this.disposed) return;
    this.pty = pty;
    void this.flush();
  }

  detach(): void {
    this.pty = null;
  }

  clear(): void {
    this.queue.length = 0;
    this.pendingBytes = 0;
  }

  enqueue(bytes: Uint8Array): boolean {
    if (
      this.disposed ||
      bytes.byteLength === 0 ||
      this.pendingBytes + bytes.byteLength > MAX_PENDING_INPUT_BYTES
    ) {
      return false;
    }
    this.queue.push(bytes);
    this.pendingBytes += bytes.byteLength;
    void this.flush();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.pty = null;
    this.queue.length = 0;
    this.pendingBytes = 0;
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.disposed || !this.pty) return;
    this.flushing = true;
    try {
      while (!this.disposed && this.pty && this.queue.length > 0) {
        const pty = this.pty;
        const batch = this.takeBatch();
        try {
          await pty.write(batch);
        } catch (error) {
          this.onError(error);
          return;
        }
      }
    } finally {
      this.flushing = false;
      if (!this.disposed && this.pty && this.queue.length > 0) {
        queueMicrotask(() => void this.flush());
      }
    }
  }

  private takeBatch(): Uint8Array {
    let length = 0;
    let count = 0;
    while (count < this.queue.length) {
      const nextLength = this.queue[count].byteLength;
      if (count > 0 && length + nextLength > MAX_WRITE_BATCH_BYTES) break;
      length += nextLength;
      count += 1;
      if (length >= MAX_WRITE_BATCH_BYTES) break;
    }

    if (count === 1) {
      const single = this.queue.shift();
      if (!single) return new Uint8Array(0);
      this.pendingBytes -= single.byteLength;
      return single;
    }
    const batch = new Uint8Array(length);
    let offset = 0;
    for (let index = 0; index < count; index += 1) {
      const chunk = this.queue[index];
      batch.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.queue.splice(0, count);
    this.pendingBytes -= length;
    return batch;
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const leafId of [...sessions.keys()]) disposeGhosttySession(leafId);
  });
}
