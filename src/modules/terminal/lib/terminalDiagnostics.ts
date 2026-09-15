import { BoundedResourceTrace } from "@/modules/terminal/lib/BoundedResourceTrace";
import { subscribeWindowPresentation } from "@/modules/terminal/ghostty/windowPresentation";
import { invoke } from "@tauri-apps/api/core";
import { supportsWasmSimd } from "@terax/ghostty-core/adapted";
import { ghosttyCoreRuntimeDiagnostics } from "@/modules/terminal/ghostty/GhosttyCoreRuntime";
import { webGpuTerminalRuntimeDiagnostics } from "@/modules/terminal/ghostty/gpu/WebGpuTerminalRuntime";
import { webGlTerminalRuntimeDiagnostics } from "@/modules/terminal/ghostty/webgl/WebGlTerminalRuntime";
import {
  ghosttySessionDiagnostics,
  ghosttySessionResourceTotals,
} from "@/modules/terminal/ghostty/useGhosttyTerminalSession";
import { ptyTransportDiagnostics } from "@/modules/terminal/lib/pty-bridge";
import { terminalResizeInteractionActive } from "@/modules/terminal/lib/terminalResizeInteraction";
import { windowPresentationDiagnostics } from "@/modules/terminal/ghostty/windowPresentation";

export function terminalDebugStats() {
  return {
    schemaVersion: 1,
    timestamp: Date.now(),
    presentation: windowPresentationDiagnostics(),
    wasmVariant: supportsWasmSimd() ? "simd" : "scalar",
    ptyTransport: ptyTransportDiagnostics(),
    ghosttyCore: ghosttyCoreRuntimeDiagnostics(),
    ghosttyWebGpu: webGpuTerminalRuntimeDiagnostics(),
    ghosttyWebGl: webGlTerminalRuntimeDiagnostics(),
    ghosttySessions: ghosttySessionDiagnostics(),
    ghosttyResources: ghosttySessionResourceTotals(),
    terminalResizeInteractionActive: terminalResizeInteractionActive(),
    domCanvases: document.querySelectorAll("canvas").length,
    jsHeapBytes:
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize ?? null,
  };
}

export async function terminalDebugSnapshot() {
  const native = await invoke("pty_diagnostics");
  return { ...terminalDebugStats(), native };
}

export function installTerminalDiagnostics(): void {
  Object.assign(window, {
    __teraxTerm: terminalDebugStats,
    __teraxTermSnapshot: terminalDebugSnapshot,
    __teraxTermTrace: recordTerminalResources,
  });
}

let activeTrace: { stop: () => unknown } | null = null;

export function recordTerminalResources() {
  activeTrace?.stop();
  const trace = new BoundedResourceTrace<ReturnType<typeof resourceSample>>();
  const capture = () => trace.record(resourceSample());
  const unsubscribe = subscribeWindowPresentation(capture);
  const timer = setInterval(capture, 1_000);
  const deadline = setTimeout(() => recording.stop(), 10 * 60_000);
  let stopped = false;
  const recording = {
    snapshot: () => trace.snapshot(),
    stop: () => {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
        clearTimeout(deadline);
        capture();
        unsubscribe();
        if (activeTrace === recording) activeTrace = null;
      }
      return trace.snapshot();
    },
  };
  activeTrace = recording;
  return recording;
}

function resourceSample() {
  const gpu = webGpuTerminalRuntimeDiagnostics();
  const gl = webGlTerminalRuntimeDiagnostics();
  return {
    timestamp: Date.now(),
    presentation: windowPresentationDiagnostics(),
    core: ghosttyCoreRuntimeDiagnostics(),
    surfaces: ghosttySessionResourceTotals(),
    webgpu: gpu && {
      atlasCount: gpu.atlasCount,
      atlasBytes: gpu.atlasBytes,
      atlasCpuBytes: gpu.atlasCpuBytes,
      stagingBytes: gpu.stagingBytes,
      inFlightFrames: gpu.inFlightFrames,
      submittedFrames: gpu.submittedFrames,
      deviceRecoveries: gpu.deviceRecoveries,
    },
    webgl: gl,
  };
}

if (import.meta.hot) import.meta.hot.dispose(() => activeTrace?.stop());
