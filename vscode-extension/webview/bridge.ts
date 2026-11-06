/**
 * The webview's link to the extension host: promise RPC for the ported Terax
 * commands, raw writes to the terminal, and the pushed per-terminal state
 * (screen text, phase, session id) the shims read synchronously.
 */
import type {
  HostEnv,
  HostToWebview,
  LeafState,
  ReaderAccent,
  ReaderFonts,
  ReaderTheme,
  WebviewToHost,
} from "../src/protocol";

type VsCodeApi = { postMessage(msg: WebviewToHost): void };
declare function acquireVsCodeApi(): VsCodeApi;

// The panel's diagnostics script acquires the API first (it can only be acquired once).
const vscode: VsCodeApi =
  (window as unknown as { __teraxVsCode?: VsCodeApi }).__teraxVsCode ?? acquireVsCodeApi();

export function hostLog(message: string, level: "info" | "error" = "info"): void {
  vscode.postMessage({ type: "log", level, message });
}

let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

export const hostState: {
  leafId: number;
  env: HostEnv | null;
  leaves: Map<number, LeafState>;
} = { leafId: 0, env: null, leaves: new Map() };

type LeafListener = (leaf: LeafState | null, leafId: number) => void;
const leafListeners = new Set<LeafListener>();

export function onLeafChange(l: LeafListener): () => void {
  leafListeners.add(l);
  return () => leafListeners.delete(l);
}

type ThemeListener = (theme: ReaderTheme, accent: ReaderAccent) => void;
const themeListeners = new Set<ThemeListener>();

export function onThemeChange(l: ThemeListener): () => void {
  themeListeners.add(l);
  return () => themeListeners.delete(l);
}

type FontsListener = (fonts: ReaderFonts) => void;
const fontsListeners = new Set<FontsListener>();

export function onFontsChange(l: FontsListener): () => void {
  fontsListeners.add(l);
  return () => fontsListeners.delete(l);
}

/** Fired on every `init`: the first one, and each switch to another terminal. */
const initListeners = new Set<() => void>();

export function onInit(l: () => void): () => void {
  initListeners.add(l);
  return () => initListeners.delete(l);
}

let readyResolve: (() => void) | null = null;
/** Resolves once the host has sent `init`. */
export const hostReady = new Promise<void>((resolve) => {
  readyResolve = resolve;
});

window.addEventListener("message", (event: MessageEvent<HostToWebview>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      hostState.leafId = msg.leafId;
      // A newer webview can meet an older extension host (a VS Code window
      // not yet reloaded after an update): fill in what it doesn't send.
      hostState.env = {
        ...msg.env,
        theme: msg.env.theme === "tokyo-night" ? "tokyo-night" : "vscode",
        accent: msg.env.accent === "theme" ? "theme" : "neutral",
        fonts: validFonts(msg.env.fonts),
      };
      for (const leaf of msg.leaves) setLeaf(leaf);
      for (const l of themeListeners) l(hostState.env.theme, hostState.env.accent);
      for (const l of fontsListeners) l(hostState.env.fonts);
      for (const l of initListeners) l();
      readyResolve?.();
      readyResolve = null;
      break;
    case "fonts": {
      const fonts = validFonts(msg.fonts);
      if (hostState.env) hostState.env = { ...hostState.env, fonts };
      for (const l of fontsListeners) l(fonts);
      break;
    }
    case "theme":
      if (hostState.env) {
        hostState.env = { ...hostState.env, theme: msg.theme, accent: msg.accent };
      }
      for (const l of themeListeners) l(msg.theme, msg.accent);
      break;
    case "leaf":
      setLeaf(msg.leaf);
      break;
    case "leafGone":
      hostState.leaves.delete(msg.leafId);
      for (const l of leafListeners) l(null, msg.leafId);
      break;
    case "rpcResult": {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(msg.error);
      break;
    }
  }
});

function validFonts(fonts: Partial<ReaderFonts> | undefined): ReaderFonts {
  const ok = (n: unknown): n is number => typeof n === "number" && n > 0;
  const code = ok(fonts?.code) ? fonts.code : 12;
  return { prose: ok(fonts?.prose) ? fonts.prose : code + 1, code };
}

function setLeaf(leaf: LeafState): void {
  hostState.leaves.set(leaf.leafId, leaf);
  for (const l of leafListeners) l(leaf, leaf.leafId);
}

export function rpc<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    vscode.postMessage({ type: "rpc", id, cmd, args });
  });
}

export function writeToTerminal(leafId: number, data: string): void {
  vscode.postMessage({ type: "write", leafId, data });
}

export function announceReady(): void {
  vscode.postMessage({ type: "ready" });
}
