import type { TerminalRendererSetting } from "@/modules/settings/store";
import type { TerminalBackendKind } from "./contracts";

const STORAGE_KEY = "terax.experimental.terminal-backend";
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

function currentPlatform(): Platform {
  return detectPlatform(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );
}

function defaultBackend(): TerminalBackendKind {
  // Windows stays on WebGL until WebView2 passes the pixel gate at 100/125/150%.
  return currentPlatform() === "windows" ? "ghostty-webgl" : "ghostty-webgpu";
}

export function selectedTerminalBackend(): TerminalBackendKind {
  const configured = parseTerminalBackend(
    import.meta.env.VITE_TERMINAL_BACKEND,
  );
  if (configured) return configured;
  if (typeof window === "undefined") return defaultBackend();
  try {
    return (
      parseTerminalBackend(window.localStorage.getItem(STORAGE_KEY)) ??
      defaultBackend()
    );
  } catch {
    return defaultBackend();
  }
}

export function setSelectedTerminalBackend(kind: TerminalBackendKind): void {
  if (typeof window === "undefined") return;
  try {
    if (kind === defaultBackend()) window.localStorage.removeItem(STORAGE_KEY);
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

function resolvedTerminalBackend(): TerminalBackendKind {
  const preferred = selectedTerminalBackend();
  if (preferred === "ghostty-webgpu" && canUseWebGpu()) return preferred;
  return "ghostty-webgl";
}

/**
 * Automatic defaults to WebGL on Windows and honours the experimental override.
 * Elsewhere it prefers WebGPU, as does an explicit WebGPU choice on any platform,
 * falling back to WebGL where the webview has no WebGPU.
 */
export function terminalBackendFor(
  setting: TerminalRendererSetting,
): TerminalBackendKind {
  if (setting === "webgl") return "ghostty-webgl";
  if (setting === "webgpu") {
    return canUseWebGpu() ? "ghostty-webgpu" : "ghostty-webgl";
  }
  return resolvedTerminalBackend();
}

/** Why new terminals draw with the renderer they do, for the diagnostics readout. */
export function terminalRendererReport(
  setting: TerminalRendererSetting = "auto",
) {
  const resolved = terminalBackendFor(setting);
  const wanted: TerminalBackendKind =
    setting === "webgl"
      ? "ghostty-webgl"
      : setting === "webgpu"
        ? "ghostty-webgpu"
        : selectedTerminalBackend();
  return {
    platform: currentPlatform(),
    setting,
    preferred: wanted,
    resolved,
    webGpuAvailable: canUseWebGpu(),
    reason:
      resolved === wanted
        ? setting === "auto"
          ? "automatic"
          : "settings"
        : "WebGPU unavailable",
  };
}

function parseTerminalBackend(value: unknown): TerminalBackendKind | null {
  return GHOSTTY_BACKENDS.has(value as never)
    ? (value as TerminalBackendKind)
    : null;
}
