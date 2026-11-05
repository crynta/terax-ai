import type { TerminalBackendKind } from "./contracts";

const STORAGE_KEY = "terax.experimental.terminal-backend";
const DEFAULT_BACKEND: TerminalBackendKind = "ghostty-webgpu";
export type Platform = "windows" | "linux" | "mac" | "other";

export function detectPlatform(userAgent: string): Platform {
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Android|Linux|X11|CrOS/i.test(userAgent)) return "linux";
  if (/Mac|iPhone|iPad/i.test(userAgent)) return "mac";
  return "other";
}

const GHOSTTY_BACKENDS = new Set<TerminalBackendKind>([
  "ghostty-webgl",
  "ghostty-webgpu",
]);

/**
 * What "Automatic" means on a platform. WebView2 has shown soft WebGPU text next to sharp
 * WebGL on the same layout (#1357) and the cause could not be reproduced off Windows, so
 * Windows starts on WebGL until WebGPU is explicitly selected
 * (`localStorage["terax.experimental.terminal-backend"] = "ghostty-webgpu"`).
 */
export function defaultTerminalBackend(platform: Platform): TerminalBackendKind {
  return platform === "windows" ? "ghostty-webgl" : DEFAULT_BACKEND;
}

function currentPlatform(): Platform {
  return detectPlatform(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );
}

export function selectedTerminalBackend(): TerminalBackendKind {
  const configured = parseTerminalBackend(
    import.meta.env.VITE_TERMINAL_BACKEND,
  );
  if (configured) return configured;
  const fallback = defaultTerminalBackend(currentPlatform());
  if (typeof window === "undefined") return fallback;
  try {
    return (
      parseTerminalBackend(window.localStorage.getItem(STORAGE_KEY)) ??
      fallback
    );
  } catch {
    return fallback;
  }
}

export function setSelectedTerminalBackend(kind: TerminalBackendKind): void {
  if (typeof window === "undefined") return;
  try {
    if (kind === defaultTerminalBackend(currentPlatform())) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else window.localStorage.setItem(STORAGE_KEY, kind);
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

/** Why new terminals draw with the renderer they do, for the diagnostics readout. */
export function terminalRendererReport() {
  const platform = currentPlatform();
  const preferred = selectedTerminalBackend();
  const resolved = resolvedTerminalBackend();
  return {
    platform,
    platformDefault: defaultTerminalBackend(platform),
    preferred,
    resolved,
    webGpuAvailable: canUseWebGpu(),
    reason:
      resolved === preferred
        ? preferred === defaultTerminalBackend(platform)
          ? "platform default"
          : "explicit selection"
        : "WebGPU unavailable",
  };
}

function parseTerminalBackend(value: unknown): TerminalBackendKind | null {
  return GHOSTTY_BACKENDS.has(value as never)
    ? (value as TerminalBackendKind)
    : null;
}
