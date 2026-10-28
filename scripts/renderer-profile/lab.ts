import { getGhosttyCoreRuntime } from "@/modules/terminal/ghostty/GhosttyCoreRuntime";
import { WebGpuTerminalSurface } from "@/modules/terminal/ghostty/gpu/WebGpuTerminalSurface";
import { webGpuTerminalRuntimeDiagnostics } from "@/modules/terminal/ghostty/gpu/WebGpuTerminalRuntime";
import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import type { TerminalGpuTheme } from "@/modules/terminal/ghostty/gpu/terminalVisuals";
import { setNativeLiveResize } from "@/modules/terminal/lib/terminalResizeGesture";
import { runNamedWorkload } from "./workloads";
declare global {
  interface Window {
    webkit: {
      messageHandlers: { report: { postMessage(value: string): void } };
    };
  }
}
// `--native-signal`: stand in for the NSWindow live-resize notifications Terax forwards from
// window_presentation.rs (the lab has no Tauri host). Without it only the heuristic runs.
if (new URLSearchParams(location.search).get("nativeSignal") === "1") {
  (window as unknown as { __teraxLiveResize: (active: boolean) => void }).__teraxLiveResize =
    setNativeLiveResize;
}
const core = getGhosttyCoreRuntime();
const host = document.querySelector("#host") as HTMLElement;
const paneCount =
  new URLSearchParams(location.search).get("panes") === "4" ? 4 : 1;
const models: GhosttyTerminalModelApi[] = [];
const surfaces: WebGpuTerminalSurface[] = [];
const renderTiming: { calls: number; milliseconds: number }[] = [];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function capture(phase: string) {
  const model = models[0];
  const inspect = new URLSearchParams(location.search).has("inspect");
  report(
    phase,
    inspect && model
      ? {
          inspection: {
            scroll: model.scrollPosition(),
            text: model.readText(model.rows),
          },
        }
      : {},
  );
}
function report(phase: string, extra = {}) {
  window.webkit.messageHandlers.report.postMessage(
    JSON.stringify({
      phase,
      at: Date.now(),
      dpr: devicePixelRatio,
      geometry: [innerWidth, innerHeight],
      paneCount,
      core: core.diagnostics(),
      gpu: webGpuTerminalRuntimeDiagnostics(),
      surfaces: surfaces.map((s) => s.diagnostics()),
      renderTiming,
      ...extra,
    }),
  );
}
window.addEventListener("error", (e) => report("error", { error: e.message }));
window.addEventListener("unhandledrejection", (e) =>
  report("error", { error: String(e.reason) }),
);
const theme: TerminalGpuTheme = {
  background: [23, 23, 23],
  foreground: [220, 220, 220],
  cursor: [220, 220, 220],
  selection: { color: [80, 100, 120], alpha: 0.5 },
  palette: Array.from({ length: 16 }, (_, i) => [i * 15, i * 12, i * 13]),
};
const metrics = {
  font: {
    family: "monospace",
    size: 13,
    lineHeight: 1.2,
    letterSpacing: 0,
    weight: "400",
  },
  // Device-pixel fields are required by newer renderer revisions and ignored by older ones.
  scale: devicePixelRatio,
  deviceCellWidth: Math.round(8 * devicePixelRatio),
  deviceCellHeight: Math.round(17 * devicePixelRatio),
  deviceBaseline: Math.round(13 * devicePixelRatio),
  cellWidth: 8,
  cellHeight: 17,
  baseline: 13,
};
async function run() {
  report("blank");
  await pause(5000);
  const groups = Array.from({ length: 2 }, () => {
    const group = document.createElement("div");
    const columns = paneCount === 4 ? 2 : 1;
    group.style.cssText = `position:absolute;inset:0;display:grid;grid-template-columns:repeat(${columns},1fr);grid-template-rows:repeat(${columns},1fr)`;
    host.append(group);
    return group;
  });
  for (let i = 0; i < 2 * paneCount; i++) {
    const pane = document.createElement("div");
    pane.style.position = "relative";
    groups[Math.floor(i / paneCount)].append(pane);
    const model = await core.createModel({
      leafId: i + 1,
      cols: 120,
      rows: 40,
      config: { scrollbackLimit: 2000 },
    });
    models.push(model);
    const surface = await WebGpuTerminalSurface.create({
      model,
      metrics,
      theme,
      cursorBlink: true,
      cursorStyle: "block",
      onResize: () => {},
      onError: (e) => report("error", { error: String(e) }),
    });
    surfaces.push(surface);
    const timing = { calls: 0, milliseconds: 0 };
    renderTiming.push(timing);
    const render = surface.prepareFrame.bind(surface);
    surface.prepareFrame = (...args) => {
      const start = performance.now();
      try {
        return render(...args);
      } finally {
        timing.calls++;
        timing.milliseconds += performance.now() - start;
      }
    };
    surface.attach(pane);
    surface.setFocused(i === 0 || (paneCount > 1 && i % paneCount === 0));
    surface.setVisible(i < paneCount);
  }
  await pause(5000);
  report("two-blank");
  const encode = new TextEncoder();
  for (let i = 0; i < 600; i++) {
    models[0].write(
      encode.encode(
        `\r\x1b[2Kagent ${i}: analyzing λ 日本語 \u{1f642} \x1b[38;5;123mstreaming output\x1b[0m`,
      ),
    );
    if (i % 20 === 0)
      models[paneCount].write(encode.encode("background agent output\r\n"));
    await pause(16);
  }
  await capture("streamed");
  await pause(3000);
  for (let i = 0; i < 100; i++) {
    for (let pane = 0; pane < paneCount; pane++)
      surfaces[(i % 2) * paneCount + pane].setVisible(false);
    for (let pane = 0; pane < paneCount; pane++)
      surfaces[((i + 1) % 2) * paneCount + pane].setVisible(true);
    await pause(30);
  }
  report("switched");
  await pause(5000);
  for (let i = 0; i < 100; i++) {
    host.style.width = `${800 + (i % 20) * 5}px`;
    host.style.height = `${450 + (i % 15) * 5}px`;
    await pause(20);
  }
  await capture("resized");
  await pause(5000);
  const repaint = encode.encode(
    "\x1b[?25l" +
      Array.from(
        { length: models[0].rows },
        (_, row) =>
          `\x1b[${row + 1};1H\x1b[2Kunchanged agent row ${row}: waiting for work`,
      ).join(""),
  );
  models[0].write(repaint);
  await pause(100);
  report("repaint-start");
  for (let index = 0; index < 100; index++) {
    models[0].write(repaint);
    await pause(16);
  }
  await capture("repainted");
  if (new URLSearchParams(location.search).has("inspect")) await pause(180_000);
  for (const surface of surfaces) surface.setVisible(false);
  report("hidden");
  await pause(5000);
  for (const surface of surfaces) surface.dispose();
  surfaces.length = 0;
  for (const model of models) model.dispose();
  models.length = 0;
  report("disposed");
  await pause(10000);
  report("done");
}
// The default workload above is unchanged; named workloads live in workloads.ts.
const workload = new URLSearchParams(location.search).get("workload") ?? "default";
(workload === "default"
  ? run()
  : runNamedWorkload(workload, {
      core,
      host,
      theme,
      metrics,
      params: new URLSearchParams(location.search),
      paneCount,
      report,
    })
).catch((error) =>
  report("error", { error: String(error), stack: error.stack }),
);
