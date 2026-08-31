import { openExternalUrl } from "@/lib/external-link";
import { ensureMonoFontsLoaded, resolveFontFamily } from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { TerminalBackendKind } from "@/modules/terminal/backend/contracts";
import { PtyResizeScheduler } from "@/modules/terminal/lib/ptyResizeScheduler";
import { subscribeTerminalResizeInteraction } from "@/modules/terminal/lib/terminalResizeInteraction";
import { useTerminalFont } from "@/modules/terminal/lib/useTerminalFont";
import type { TerminalSearchController } from "@/modules/terminal/search/TerminalSearchController";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { openPty, type PtySession } from "../lib/pty-bridge";
import { writeTerminalClipboard } from "../lib/terminalClipboard";
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
import {
  WebGlTerminalSurface,
  type WebGlTerminalSurfaceOptions,
} from "./webgl/WebGlTerminalSurface";

type GhosttyBackend = Extract<TerminalBackendKind, `ghostty-${string}`>;
type GhosttySurface = WebGpuTerminalSurface | WebGlTerminalSurface;
type GhosttySurfaceBaseOptions = Omit<WebGlTerminalSurfaceOptions, "onError">;

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_PENDING_INPUT_BYTES = 256 * 1024;
const MAX_WRITE_BATCH_BYTES = 64 * 1024;

type Callbacks = {
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
  input: GhosttyInputController | null;
  pty: PtySession | null;
  ptyResize: PtyResizeScheduler;
  unsubscribeResizeInteraction: () => void;
  writer: BoundedPtyWriter;
  container: HTMLDivElement | null;
  callbacks: Callbacks;
  visible: boolean;
  focused: boolean;
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

type Options = {
  leafId: number;
  backend: GhosttyBackend;
  container: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  focused: boolean;
  initialCwd?: string;
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
  onSearchReady,
  onExit,
  onCwd,
}: Options) {
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
    const node = container.current;
    session.container = node;
    session.callbacks = {
      onSearchReady: (search) => callbackRef.current.onSearchReady?.(search),
      onExit: (code) => callbackRef.current.onExit?.(code),
      onCwd: (cwd) => callbackRef.current.onCwd?.(cwd),
    };
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
  }, [leafId, backend, container]);

  useEffect(() => {
    const session = sessions.get(leafId);
    if (!session || session.backend !== backend) return;
    void updateSessionFont(session, font);
  }, [leafId, backend, font]);

  useEffect(() => {
    const session = ensureSession(leafId, backend, initialCwdRef.current);
    session.visible = visible;
    session.focused = focused;
    const surface = session.surface;
    if (!surface) return;
    if (visible && session.container) {
      surface.attach(session.container);
      surface.setVisible(true);
      surface.setFocused(focused);
      if (focused) surface.focus();
    } else {
      surface.setVisible(false);
      surface.detach();
    }
  }, [leafId, backend, visible, focused]);

  const cursorBlink = usePreferencesStore((state) => state.terminalCursorBlink);
  const cursorStyle = usePreferencesStore((state) => state.terminalCursorStyle);
  useEffect(() => {
    sessions.get(leafId)?.surface?.setCursorOptions(cursorBlink, cursorStyle);
  }, [leafId, cursorBlink, cursorStyle]);

  const write = useCallback(
    (data: string) => {
      writeToGhosttySession(leafId, data);
    },
    [leafId],
  );
  const focus = useCallback(
    () => sessions.get(leafId)?.surface?.focus(),
    [leafId],
  );
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
  }, [leafId]);

  return useMemo(
    () => ({
      write,
      focus,
      getBuffer,
      getSelection,
      applyTheme,
    }),
    [write, focus, getBuffer, getSelection, applyTheme],
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
  return session.writer.enqueue(textEncoder.encode(data));
}

export function interruptGhosttySession(leafId: number): boolean {
  const session = sessions.get(leafId);
  return session?.writer.enqueue(Uint8Array.of(3)) ?? false;
}

export function clearGhosttySession(leafId: number): boolean {
  const session = sessions.get(leafId);
  if (!session?.model || session.disposed) return false;
  session.model.clear();
  session.surface?.focus();
  return true;
}

export function pasteIntoGhosttySession(leafId: number, text: string): boolean {
  const session = sessions.get(leafId);
  if (!session?.input) return false;
  session.input.paste(text);
  session.surface?.focus();
  return true;
}

export function ghosttySelectionForLeaf(leafId: number): string | null {
  return sessions.get(leafId)?.surface?.getSelection() ?? null;
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
  return !!session.model && !session.disposed;
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
  session.model?.dispose();
  session.model = null;
  session.ptyResize.reset();
  session.writer.detach();
  session.writer.clear();
  await session.pty?.close();
  session.pty = null;
  session.shellExited = false;
  session.lastCwd = null;
  session.initialCwd = cwd ?? session.initialCwd;
  session.initializing = null;
  await initializeSession(session);
  return true;
}

export function ghosttySessionDiagnostics() {
  return [...sessions.values()].map((session) => ({
    leafId: session.leafId,
    pty: session.pty?.id ?? null,
    visible: session.visible,
    focused: session.focused,
    shellExited: session.shellExited,
    model: session.model?.diagnostics() ?? null,
    surface: session.surface?.diagnostics() ?? null,
    ptyResize: session.ptyResize.diagnostics(),
    pendingInputBytes: session.writer.pendingBytes,
    startup: startupDiagnostics(session.startup),
  }));
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
  if (session.initializing) return session.initializing;
  const generation = ++session.generation;
  session.initializing = initializeSessionGeneration(session, generation).catch(
    (error: unknown) => {
      if (session.disposed || generation !== session.generation) return;
      session.shellExited = true;
      console.error("[terax] Ghostty session initialization failed:", error);
      session.callbacks.onExit?.(-1);
    },
  );
  return session.initializing;
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
      queueMicrotask(() => void writeTerminalClipboard(text));
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
    onEvent: (event) => semanticEvents.handle(event),
  });
  if (session.disposed || generation !== session.generation) {
    model.dispose();
    return;
  }
  mark("modelReadyMs");
  session.model = model;

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
    onOpenLink: (uri: string) => {
      void openExternalUrl(uri, () => session.surface?.focus());
    },
  };
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
  let surface: GhosttySurface;
  if (session.backend === "ghostty-webgpu" && !webGpuPreload.error) {
    try {
      surface = await WebGpuTerminalSurface.create(webGpuSurfaceOptions);
    } catch (error) {
      webGpuPreload.error = toError(error);
      surface = createWebGlFallbackSurface(surfaceBaseOptions);
    }
  } else if (session.backend === "ghostty-webgpu") {
    surface = createWebGlFallbackSurface(surfaceBaseOptions);
  } else {
    surface = new WebGlTerminalSurface({
      ...surfaceBaseOptions,
      onError: (error) => logSurfaceError("ghostty-webgl", error),
    });
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
      const failedSurface = surface;
      const failedInput = session.input;
      const replacement = createWebGlFallbackSurface(surfaceBaseOptions);
      try {
        attachGhosttySurface(session, replacement);
      } catch (fallbackError) {
        replacement.dispose();
        throw new Error(
          `WebGPU surface attachment failed (${toError(error).message}); WebGL fallback also failed (${toError(fallbackError).message})`,
        );
      }
      webGpuFallbackStarted = true;
      session.surface = replacement;
      session.input = createGhosttyInput(session, model, replacement);
      failedInput?.dispose();
      failedSurface.dispose();
      surface = replacement;
      console.warn(
        "[terax] WebGPU surface attachment failed; preserved the Ghostty session with WebGL:",
        toError(error).message,
      );
    }
  }
  session.callbacks.onSearchReady?.(surface.searchController());

  const pty = await openPty(
    model.cols,
    model.rows,
    {
      onData: (bytes) => {
        if (!session.disposed && generation === session.generation) {
          mark("firstOutputMs");
          model.write(bytes);
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
    false,
    preferences.terminalShell || undefined,
    session.leafId,
  );
  if (session.disposed || generation !== session.generation) {
    await pty.close();
    return;
  }
  mark("ptyReadyMs");
  session.pty = pty;
  session.writer.attach(pty);
  if (pty && (model.cols !== DEFAULT_COLS || model.rows !== DEFAULT_ROWS)) {
    await pty.resize(model.cols, model.rows);
  }
}

function createGhosttyInput(
  session: GhosttySession,
  model: GhosttyTerminalModelApi,
  surface: GhosttySurface,
): GhosttyInputController {
  return new GhosttyInputController({
    model,
    input: surface.inputElement(),
    pointerTarget: surface.eventTarget(),
    cellSize: () => ({
      width: surface.cellSize().width,
      height: surface.cellSize().height,
    }),
    onData: (bytes) => {
      session.writer.enqueue(bytes);
    },
    onCopy: () => {
      const text = surface.getSelection();
      if (!text) return false;
      void writeTerminalClipboard(text);
      return true;
    },
  });
}

function attachGhosttySurface(
  session: GhosttySession,
  surface: GhosttySurface,
): void {
  if (!session.container) return;
  surface.attach(session.container);
  surface.setVisible(true);
  surface.setFocused(session.focused);
  if (session.focused) surface.focus();
}

function createWebGlFallbackSurface(
  options: GhosttySurfaceBaseOptions,
): WebGlTerminalSurface {
  return new WebGlTerminalSurface({
    ...options,
    onError: (error) => logSurfaceError("ghostty-webgl", error),
  });
}

function fallbackWebGpuSurface(
  session: GhosttySession,
  generation: number,
  options: GhosttySurfaceBaseOptions,
  cause: Error,
): void {
  const failedSurface = session.surface;
  if (
    session.disposed ||
    generation !== session.generation ||
    failedSurface?.backend !== "ghostty-webgpu" ||
    !session.model
  ) {
    return;
  }

  const replacement = createWebGlFallbackSurface(options);
  try {
    if (session.visible && session.container) {
      attachGhosttySurface(session, replacement);
    }
  } catch (error) {
    replacement.dispose();
    console.error(
      "[terax] WebGL fallback failed after a WebGPU runtime error:",
      toError(error),
    );
    return;
  }

  const failedInput = session.input;
  session.surface = replacement;
  session.input = createGhosttyInput(session, session.model, replacement);
  session.callbacks.onSearchReady?.(replacement.searchController());
  failedInput?.dispose();
  failedSurface.dispose();
  if (session.focused) replacement.focus();
  console.warn(
    "[terax] WebGPU renderer failed; preserved the live Ghostty model, PTY, and scrollback with WebGL:",
    cause.message,
  );
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
