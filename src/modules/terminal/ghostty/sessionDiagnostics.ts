import { ghosttyBlocks } from "./ghosttyBlockSessions";
import { webGpuTerminalRuntimeDiagnostics } from "./gpu/WebGpuTerminalRuntime";
import { ghosttySessionsForDiagnostics } from "./useGhosttyTerminalSession";

export function ghosttySessionDiagnostics() {
  return [...ghosttySessionsForDiagnostics()].map((session) => ({
    leafId: session.leafId,
    backend: session.backend,
    font: session.font,
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
    startup: {
      fontsReadyMs: session.startup.fontsReadyMs,
      coreReadyMs: session.startup.coreReadyMs,
      gpuReadyMs: session.startup.gpuReadyMs,
      modelReadyMs: session.startup.modelReadyMs,
      surfaceReadyMs: session.startup.surfaceReadyMs,
      ptyReadyMs: session.startup.ptyReadyMs,
      firstOutputMs: session.startup.firstOutputMs,
      firstFrameMs: session.startup.firstFrameMs,
      firstPromptMs: session.startup.firstPromptMs,
    },
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

  for (const session of ghosttySessionsForDiagnostics()) {
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

  // The WebGPU swapchain belongs to the window canvases, not to the panes drawing into them.
  const windowCanvasBytes =
    webGpuTerminalRuntimeDiagnostics()?.canvases.colorBytes ?? 0;
  canvasColorBytes += windowCanvasBytes;
  estimatedSwapchainBytes += windowCanvasBytes * 3;

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
