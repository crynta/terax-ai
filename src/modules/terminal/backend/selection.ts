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

function canUseWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export type TerminalRendererCapabilities = {
  readonly webGpu: boolean;
  readonly webGl2: boolean;
  readonly wasmSimd: boolean;
};

export function resolveTerminalBackend(
  preferred: TerminalBackendKind,
  capabilities: TerminalRendererCapabilities,
): TerminalBackendKind {
  if (preferred === "ghostty-webgpu" && capabilities.webGpu) return preferred;
  if (capabilities.webGl2) return "ghostty-webgl";
  return "ghostty-webgl";
}

export function resolvedTerminalBackend(): TerminalBackendKind {
  const preferred = selectedTerminalBackend();
  if (preferred === "ghostty-webgpu" && canUseWebGpu()) return preferred;
  return "ghostty-webgl";
}

function parseTerminalBackend(value: unknown): TerminalBackendKind | null {
  return GHOSTTY_BACKENDS.has(value as never)
    ? (value as TerminalBackendKind)
    : null;
}
