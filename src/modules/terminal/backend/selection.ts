import type { TerminalBackendKind } from "./contracts";

const STORAGE_KEY = "terax.experimental.terminal-backend";
const DEFAULT_BACKEND: TerminalBackendKind = "ghostty-webgpu";
const GHOSTTY_BACKENDS = new Set<TerminalBackendKind>([
  "ghostty-webgl",
  "ghostty-webgpu",
]);

export function selectedTerminalBackend(): TerminalBackendKind {
  const configured = parseTerminalBackend(
    import.meta.env.VITE_TERMINAL_BACKEND,
  );
  if (configured) return configured;
  if (typeof window === "undefined") return DEFAULT_BACKEND;
  try {
    return (
      parseTerminalBackend(window.localStorage.getItem(STORAGE_KEY)) ??
      DEFAULT_BACKEND
    );
  } catch {
    return DEFAULT_BACKEND;
  }
}

export function setSelectedTerminalBackend(kind: TerminalBackendKind): void {
  if (typeof window === "undefined") return;
  try {
    if (kind === DEFAULT_BACKEND) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, kind);
  } catch {
    // Storage can be disabled by the webview policy. The build default remains.
  }
}

export function canUseWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export type TerminalRendererCapabilities = {
  readonly webGpu: boolean;
  readonly webGl2: boolean;
};

export function resolveTerminalBackend(
  preferred: TerminalBackendKind,
  capabilities: TerminalRendererCapabilities,
): TerminalBackendKind {
  if (preferred === "xterm-webgl") return preferred;
  if (preferred === "ghostty-webgpu" && capabilities.webGpu) return preferred;
  if (capabilities.webGl2) return "ghostty-webgl";
  return "xterm-webgl";
}

export function resolvedTerminalBackend(): TerminalBackendKind {
  const preferred = selectedTerminalBackend();
  if (preferred === "xterm-webgl") return preferred;
  if (preferred === "ghostty-webgpu" && canUseWebGpu()) return preferred;
  return canUseWebGl2() ? "ghostty-webgl" : "xterm-webgl";
}

let webGl2Available: boolean | null = null;

export function canUseWebGl2(): boolean {
  if (webGl2Available !== null) return webGl2Available;
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    failIfMajorPerformanceCaveat: true,
  });
  const available = context !== null;
  context?.getExtension("WEBGL_lose_context")?.loseContext();
  webGl2Available = available;
  return webGl2Available;
}

export function isGhosttyBackend(
  kind: TerminalBackendKind,
): kind is "ghostty-webgl" | "ghostty-webgpu" {
  return GHOSTTY_BACKENDS.has(kind);
}

function parseTerminalBackend(value: unknown): TerminalBackendKind | null {
  return value === "xterm-webgl" || GHOSTTY_BACKENDS.has(value as never)
    ? (value as TerminalBackendKind)
    : null;
}
