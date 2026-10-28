// Named workloads for the isolated renderer lab. The legacy default workload stays in lab.ts.
//
// Timeline model: the page owns the workload. Whenever the orchestrator must sample the host
// and WebKit helpers, the page awaits `sync()`, which prints the event (with page and native
// state) and resumes only after run.py has finished sampling. Window actions (order out, cover,
// miniaturize, move) are requested from the native host through `native()`.
//
// Output is fed through the same GhosttyTerminalModelApi.write() the default workload uses; no
// PTY, shell, Tauri IPC or React is involved.
import * as presentationModule from "@/modules/terminal/ghostty/windowPresentation";
import * as runtimeModule from "@/modules/terminal/ghostty/gpu/WebGpuTerminalRuntime";
import { WebGpuTerminalSurface } from "@/modules/terminal/ghostty/gpu/WebGpuTerminalSurface";
import type { getGhosttyCoreRuntime } from "@/modules/terminal/ghostty/GhosttyCoreRuntime";
import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import type { TerminalGpuTheme } from "@/modules/terminal/ghostty/gpu/terminalVisuals";

export type LabContext = {
  core: ReturnType<typeof getGhosttyCoreRuntime>;
  host: HTMLElement;
  theme: TerminalGpuTheme;
  metrics: Parameters<typeof WebGpuTerminalSurface.create>[0]["metrics"];
  params: URLSearchParams;
  paneCount: number;
  report(phase: string, extra?: object): void;
};

type NativeBridge = { postMessage(value: object): Promise<string> };
type Pane = {
  model: GhosttyTerminalModelApi;
  surface: WebGpuTerminalSurface;
  timing: { calls: number; milliseconds: number };
  group: number;
};

// Renderer diagnostics hooks are read through their module namespaces so that a candidate build
// that renames or drops one still produces a report (with the field missing) instead of failing.
type Diagnostics = { reclamations: number; transitions: number } & Record<string, unknown>;
const windowPresentationDiagnostics = (): Partial<Diagnostics> =>
  (
    (presentationModule as Record<string, unknown>).windowPresentationDiagnostics as
      | (() => Diagnostics)
      | undefined
  )?.() ?? {};
type GpuDiagnostics = { windowFocused?: boolean } & Record<string, unknown>;
const webGpuTerminalRuntimeDiagnostics = (): GpuDiagnostics | null =>
  (
    (runtimeModule as Record<string, unknown>).webGpuTerminalRuntimeDiagnostics as
      | (() => GpuDiagnostics | null)
      | undefined
  )?.() ?? null;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const macrotask = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
const number = (params: URLSearchParams, key: string, fallback: number) => {
  const value = Number(params.get(key));
  return params.has(key) && Number.isFinite(value) ? value : fallback;
};

// ---------------------------------------------------------------------------------------------
// Native bridge and sampling handshake
// ---------------------------------------------------------------------------------------------

const bridge = () =>
  (window as unknown as { webkit: { messageHandlers: { native: NativeBridge } } }).webkit
    .messageHandlers.native;

// biome-ignore lint/suspicious/noExplicitAny: native replies are JSON documents
async function native(cmd: string, args: object = {}): Promise<any> {
  return JSON.parse(await bridge().postMessage({ cmd, ...args }));
}

// ---------------------------------------------------------------------------------------------
// Optional canvas lifecycle instrumentation (lab-only; patches DOM/WebGPU prototypes)
// ---------------------------------------------------------------------------------------------

const canvasStats = {
  instrumented: false,
  canvasCreated: 0,
  canvasFinalized: 0,
  contextCreated: 0,
  contextFinalized: 0,
  configure: 0,
  unconfigure: 0,
  textureAcquired: 0,
  textureFinalized: 0,
};

function installCanvasInstrumentation(): void {
  if (typeof FinalizationRegistry !== "function") return;
  canvasStats.instrumented = true;
  const canvases = new FinalizationRegistry(() => canvasStats.canvasFinalized++);
  const contexts = new FinalizationRegistry(() => canvasStats.contextFinalized++);
  const textures = new FinalizationRegistry(() => canvasStats.textureFinalized++);
  const createElement = document.createElement.bind(document);
  document.createElement = ((tag: string, options?: ElementCreationOptions) => {
    const element = createElement(tag, options);
    if (tag.toLowerCase() === "canvas") {
      canvasStats.canvasCreated++;
      canvases.register(element, 0);
    }
    return element;
  }) as typeof document.createElement;
  const seenContexts = new WeakSet<object>();
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    // biome-ignore lint/suspicious/noExplicitAny: forwarding overloaded arguments
    ...args: any[]
  ) {
    // biome-ignore lint/suspicious/noExplicitAny: forwarding overloaded arguments
    const context = (getContext as any).apply(this, args);
    if (context && args[0] === "webgpu" && !seenContexts.has(context)) {
      seenContexts.add(context);
      canvasStats.contextCreated++;
      contexts.register(context, 0);
    }
    return context;
    // biome-ignore lint/suspicious/noExplicitAny: forwarding overloaded arguments
  } as any;
  // biome-ignore lint/suspicious/noExplicitAny: GPUCanvasContext is not in every lib.dom
  const prototype = (window as any).GPUCanvasContext?.prototype;
  if (!prototype) return;
  const seenTextures = new WeakSet<object>();
  const wrap = (name: string, before: (result: unknown) => void) => {
    const original = prototype[name];
    // biome-ignore lint/suspicious/noExplicitAny: forwarding arguments
    prototype[name] = function (this: unknown, ...args: any[]) {
      const result = original.apply(this, args);
      before(result);
      return result;
    };
  };
  wrap("configure", () => canvasStats.configure++);
  wrap("unconfigure", () => canvasStats.unconfigure++);
  wrap("getCurrentTexture", (texture) => {
    if (!texture || seenTextures.has(texture as object)) return;
    seenTextures.add(texture as object);
    canvasStats.textureAcquired++;
    textures.register(texture as object, 0);
  });
}

/** Ask the JS engine to collect, then wait for finalizers. Lab-only; used by --force-gc. */
async function allocateGarbage(): Promise<{ chunks: number; objects: number }> {
  let objects = 0;
  let chunks = 0;
  for (let round = 0; round < 6; round++) {
    // External (ArrayBuffer) memory pressure reaches the collector's allocation heuristics.
    for (let index = 0; index < 4; index++) {
      const buffer = new Uint8Array(64 * 1024 * 1024);
      buffer[0] = index;
      chunks++;
      await macrotask();
    }
    // Plain object churn promotes and then drops a large young/old generation.
    let churn: object[] | null = Array.from({ length: 400_000 }, (_, i) => ({ i, text: `g${i}` }));
    objects += churn.length;
    churn = null;
    await macrotask();
  }
  return { chunks, objects };
}

type GcKind = "none" | "alloc" | "private" | "both";
async function attemptGc(kind: GcKind, settleMs = 1500) {
  const before = { ...canvasStats };
  const result: {
    kind: GcKind;
    privateGc: unknown;
    allocated: unknown;
    canvasFinalizedDelta: number;
    contextFinalizedDelta: number;
    textureFinalizedDelta: number;
    domCanvases: number;
  } = {
    kind,
    privateGc: null,
    allocated: null,
    canvasFinalizedDelta: 0,
    contextFinalizedDelta: 0,
    textureFinalizedDelta: 0,
    domCanvases: 0,
  };
  if (kind === "private" || kind === "both") result.privateGc = await native("gc");
  if (kind === "alloc" || kind === "both") result.allocated = await allocateGarbage();
  await native("sleep", { ms: settleMs });
  result.canvasFinalizedDelta = canvasStats.canvasFinalized - before.canvasFinalized;
  result.contextFinalizedDelta = canvasStats.contextFinalized - before.contextFinalized;
  result.textureFinalizedDelta = canvasStats.textureFinalized - before.textureFinalized;
  result.domCanvases = document.querySelectorAll("canvas").length;
  return result;
}

// ---------------------------------------------------------------------------------------------
// Ink / Claude-Code-like output generator
// ---------------------------------------------------------------------------------------------

const SPINNER = ["·", "✢", "✳", "✶", "✻", "✽"];
const WORDS = (
  "the renderer presents damaged rows through a shared atlas while hidden panes keep parsing " +
  "output without allocating presentation buffers and agents keep streaming tokens into scrollback"
).split(" ");
const REGION_LINES = 12;
const ERASE_REGION = "\x1b[2K\x1b[1A".repeat(REGION_LINES) + "\x1b[2K\x1b[G";
const encoder = new TextEncoder();

const clip = (text: string, width: number) => {
  const glyphs = Array.from(text);
  return glyphs.length <= width ? text : glyphs.slice(0, width).join("");
};

type DriverStats = {
  renders: number;
  bytes: number;
  writeMs: number;
  lagSumMs: number;
  lagMaxMs: number;
  lagSamples: number;
};
const driverStats: DriverStats = {
  renders: 0,
  bytes: 0,
  writeMs: 0,
  lagSumMs: 0,
  lagMaxMs: 0,
  lagSamples: 0,
};

/**
 * Mimics an Ink application: every render erases the previous 12-line dynamic region with
 * cursor-up + erase-line, then rewrites it. Content is identical between renders apart from the
 * spinner glyph and the partially streamed token line; completed token lines are flushed above
 * the region into scrollback, exactly where Ink's <Static> output lands.
 */
class InkAgent {
  private spinner = 0;
  private stream = "";
  private rendered = false;
  private seed: number;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private running = false;

  constructor(
    private readonly model: GhosttyTerminalModelApi,
    seed: number,
  ) {
    this.seed = seed * 2654435761;
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  private nextTokens(chars: number): string {
    let text = "";
    while (text.length < chars) text += `${WORDS[Math.floor(this.random() * WORDS.length)]} `;
    return text.slice(0, chars);
  }

  private region(width: number): string {
    const dim = (text: string) => `\x1b[90m${clip(text, width)}\x1b[0m`;
    const lines = [
      dim("─".repeat(width)),
      `\x1b[38;5;209m${SPINNER[this.spinner % SPINNER.length]}\x1b[0m \x1b[38;5;209mThinking…\x1b[0m ${dim("(esc to interrupt · ctrl+t to show todos)")}`,
      "",
      `\x1b[38;5;75m●\x1b[0m ${clip(this.stream, width - 3)}`,
      "",
      `  ${dim("⎿")}  \x1b[32m☒\x1b[0m ${clip("Read renderer sources and window policy", width - 8)}`,
      `     \x1b[32m☒\x1b[0m ${clip("Add occlusion and agent workloads to the lab", width - 8)}`,
      `     \x1b[1m☐\x1b[0m ${clip("Capture baseline footprint, CPU and energy", width - 8)}`,
      `     ☐ ${clip("Compare candidate against the baseline report", width - 8)}`,
      dim(`╭${"─".repeat(Math.max(0, width - 2))}╮`),
      `\x1b[90m│\x1b[0m > ${clip('Try "fix the failing test"', width - 6).padEnd(Math.max(0, width - 6))} \x1b[90m│\x1b[0m`,
      dim(`╰${"─".repeat(Math.max(0, width - 2))}╯`),
    ];
    return `${lines.join("\r\n")}\r\n`;
  }

  /** One Ink render. `token` appends streamed text; otherwise only the spinner advances. */
  render(token: boolean): void {
    const width = Math.max(40, this.model.cols - 1);
    if (token) this.stream += this.nextTokens(40);
    else this.spinner++;
    let output = this.rendered ? ERASE_REGION : "";
    if (this.stream.length >= width - 6) {
      output += `\x1b[38;5;75m●\x1b[0m ${clip(this.stream, width - 3)}\r\n`;
      this.stream = "";
    }
    output += this.region(width);
    this.rendered = true;
    const bytes = encoder.encode(output);
    const start = performance.now();
    try {
      this.model.write(bytes);
    } finally {
      driverStats.writeMs += performance.now() - start;
      driverStats.renders++;
      driverStats.bytes += bytes.byteLength;
    }
  }

  start(spinnerMs: number, tokenMs: number, offsetMs: number): void {
    this.running = true;
    this.schedule(spinnerMs, offsetMs, false);
    this.schedule(tokenMs, offsetMs / 2 + 7, true);
  }

  private schedule(period: number, offset: number, token: boolean): void {
    const origin = performance.now() + offset;
    let count = 0;
    const tick = () => {
      if (!this.running) return;
      const lag = performance.now() - (origin + count * period);
      driverStats.lagSumMs += Math.max(0, lag);
      driverStats.lagMaxMs = Math.max(driverStats.lagMaxMs, lag);
      driverStats.lagSamples++;
      this.render(token);
      count++;
      const timer = setTimeout(tick, Math.max(0, origin + count * period - performance.now()));
      this.timers.add(timer);
    };
    this.timers.add(setTimeout(tick, offset));
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}

// ---------------------------------------------------------------------------------------------
// Pane construction
// ---------------------------------------------------------------------------------------------

async function createPane(
  context: LabContext,
  container: HTMLElement,
  leafId: number,
  group: number,
  visible: boolean,
  focused: boolean,
  cursorBlink: boolean,
  fail: (error: unknown) => void,
): Promise<Pane> {
  const model = await context.core.createModel({
    leafId,
    cols: 120,
    rows: 40,
    config: { scrollbackLimit: 2000 },
  });
  const surface = await WebGpuTerminalSurface.create({
    model,
    metrics: context.metrics,
    theme: context.theme,
    cursorBlink,
    cursorStyle: "block",
    onResize: () => {},
    onError: fail,
  });
  const timing = { calls: 0, milliseconds: 0 };
  // Time the per-pane work of a frame: what the surface uploads (the window canvas draws all panes).
  const prepare = surface.prepareFrame.bind(surface);
  surface.prepareFrame = (...args) => {
    const start = performance.now();
    try {
      return prepare(...args);
    } finally {
      timing.calls++;
      timing.milliseconds += performance.now() - start;
    }
  };
  surface.attach(container);
  surface.setFocused(focused);
  surface.setVisible(visible);
  return { model, surface, timing, group };
}

function createGroup(host: HTMLElement, columns: number): HTMLElement {
  const group = document.createElement("div");
  group.style.cssText = `position:absolute;inset:0;display:grid;grid-template-columns:repeat(${columns},1fr);grid-template-rows:repeat(${columns},1fr)`;
  host.append(group);
  return group;
}

function createCell(group: HTMLElement): HTMLElement {
  const cell = document.createElement("div");
  cell.style.position = "relative";
  group.append(cell);
  return cell;
}

/** Same two-tab layout as the default workload: tab 0 visible, tab 1 retained but hidden. */
async function buildTabs(context: LabContext, cursorBlink: boolean, fail: (e: unknown) => void) {
  const panes: Pane[] = [];
  const columns = context.paneCount === 4 ? 2 : 1;
  const groups = [createGroup(context.host, columns), createGroup(context.host, columns)];
  for (let index = 0; index < 2 * context.paneCount; index++) {
    const group = Math.floor(index / context.paneCount);
    panes.push(
      await createPane(
        context,
        createCell(groups[group]),
        index + 1,
        group,
        group === 0,
        group === 0 && index % context.paneCount === 0,
        cursorBlink,
        fail,
      ),
    );
  }
  return panes;
}

/** K visible panes in one grid plus H retained models whose surfaces are hidden. */
async function buildAgents(
  context: LabContext,
  hidden: number,
  cursorBlink: boolean,
  fail: (e: unknown) => void,
) {
  const panes: Pane[] = [];
  const columns = context.paneCount === 4 ? 2 : 1;
  const visibleGroup = createGroup(context.host, columns);
  const hiddenGroup = createGroup(context.host, 1);
  for (let index = 0; index < context.paneCount; index++)
    panes.push(
      await createPane(
        context,
        createCell(visibleGroup),
        index + 1,
        0,
        true,
        index === 0,
        cursorBlink,
        fail,
      ),
    );
  for (let index = 0; index < hidden; index++)
    panes.push(
      await createPane(
        context,
        createCell(hiddenGroup),
        context.paneCount + index + 1,
        1,
        false,
        false,
        cursorBlink,
        fail,
      ),
    );
  return panes;
}

/** Tab 0: one full-size pane. Tab 1: four panes in a 2x2 grid. Switching reshapes every canvas. */
async function buildMixedTabs(
  context: LabContext,
  cursorBlink: boolean,
  fail: (e: unknown) => void,
) {
  const panes: Pane[] = [];
  const single = createGroup(context.host, 1);
  const grid = createGroup(context.host, 2);
  panes.push(
    await createPane(context, createCell(single), 1, 0, true, true, cursorBlink, fail),
  );
  for (let index = 0; index < 4; index++)
    panes.push(
      await createPane(context, createCell(grid), index + 2, 1, false, index === 0, cursorBlink, fail),
    );
  return panes;
}

// ---------------------------------------------------------------------------------------------
// Event payload
// ---------------------------------------------------------------------------------------------

type Run = {
  context: LabContext;
  panes: Pane[];
  agents: InkAgent[];
  heartbeats: object[];
  syncId: number;
};

function describe(run: Run, extra: object = {}) {
  const gpu = webGpuTerminalRuntimeDiagnostics();
  return {
    at: Date.now(),
    perf: performance.now(),
    dpr: devicePixelRatio,
    geometry: [innerWidth, innerHeight],
    paneCount: run.context.paneCount,
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
    core: run.context.core.diagnostics(),
    gpu,
    surfaces: run.panes.map((pane) => pane.surface.diagnostics()),
    renderTiming: run.panes.map((pane) => pane.timing),
    presentation: windowPresentationDiagnostics(),
    canvases: { ...canvasStats, domCanvases: document.querySelectorAll("canvas").length },
    driver: { ...driverStats },
    heartbeats: run.heartbeats,
    ...extra,
  };
}

async function sync(run: Run, phase: string, extra: object = {}) {
  const id = ++run.syncId;
  await native("sync", { id, event: JSON.stringify({ phase, ...describe(run, extra) }) });
}

function startHeartbeat(run: Run, intervalMs: number): () => void {
  const beat = () =>
    run.heartbeats.push({
      at: Date.now(),
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
      windowFocused: webGpuTerminalRuntimeDiagnostics()?.windowFocused ?? null,
      suspendedVisibleSurfaces: run.panes.filter((pane) => {
        const stats = pane.surface.diagnostics();
        return stats.visible && stats.documentSuspended;
      }).length,
    });
  beat();
  const timer = setInterval(beat, intervalMs);
  return () => clearInterval(timer);
}

function startAgents(run: Run, spinnerMs: number, tokenMs: number): void {
  run.agents = run.panes.map((pane, index) => new InkAgent(pane.model, index + 1));
  run.agents.forEach((agent, index) => {
    // Spread phases so agents do not render in lockstep, like independent sessions.
    agent.start(spinnerMs, tokenMs, (index * spinnerMs) / Math.max(1, run.agents.length));
  });
}

const stopAgents = (run: Run) => {
  for (const agent of run.agents) agent.stop();
};

// ---------------------------------------------------------------------------------------------
// Workloads
// ---------------------------------------------------------------------------------------------

async function occlusion(run: Run) {
  const { params } = run.context;
  const mode = params.get("mode") ?? "orderout";
  const cycles = number(params, "cycles", 40);
  const hiddenMs = number(params, "hiddenMs", 3000);
  const visibleMs = number(params, "visibleMs", 2000);
  const gcKind = (params.get("gc") ?? "none") as GcKind;
  const gcWhen = params.get("gcWhen") ?? "end";
  const sampleHidden = params.get("sampleHidden") !== "0";
  await native("show", { mode: "orderout" }); // ensure the window is key and active
  startAgents(run, 250, 500);
  await pause(3000);
  await sync(run, "setup", { mode, cycles, hiddenMs, visibleMs, gcKind, gcWhen, sampleHidden });
  await pause(2000);
  await sync(run, "baseline", { cycle: 0 });
  for (let cycle = 1; cycle <= cycles; cycle++) {
    const reclaimsBefore = windowPresentationDiagnostics().reclamations ?? 0;
    const hide = await native("hide", { mode });
    await native("sleep", { ms: hiddenMs });
    let gc = null;
    if (gcKind !== "none" && (gcWhen === "cycle" || gcWhen === "both"))
      gc = await attemptGc(gcKind, 500);
    const reclaimed = () => (windowPresentationDiagnostics().reclamations ?? 0) - reclaimsBefore;
    let hiddenDiag = null;
    if (sampleHidden) {
      // Sampling keeps the window hidden for as long as the orchestrator takes (footprint and
      // vmmap calls), so the effective hold is hiddenMs plus that time.
      await sync(run, `cycle-${cycle}-hidden`, {
        cycle,
        step: "hidden",
        hide,
        gc,
        reclaimedThisCycle: reclaimed(),
      });
    } else {
      // Control without a hidden sample: the hold really is hiddenMs.
      hiddenDiag = { visibility: document.visibilityState, reclaimedAtHoldEnd: reclaimed() };
    }
    const show = await native("show", { mode });
    await pause(visibleMs);
    await sync(run, `cycle-${cycle}-visible`, {
      cycle,
      step: "visible",
      show,
      ...(sampleHidden ? {} : { hide, hiddenDiag, reclaimedThisCycle: reclaimed() }),
    });
  }
  await sync(run, "cycles-complete");
  await pause(10_000);
  await sync(run, "end+10s");
  await pause(20_000);
  await sync(run, "end+30s");
  if (gcKind !== "none" && (gcWhen === "end" || gcWhen === "both")) {
    const gc = await attemptGc(gcKind, 1500);
    await sync(run, "post-gc+2s", { gc });
    await pause(8000);
    await sync(run, "post-gc+10s");
    await pause(20_000);
    await sync(run, "post-gc+30s");
  }
}

/**
 * Raw WebGPU canvas lifecycle probe (no Terax renderer): isolates which canvas teardown
 * strategy leaves graphics memory behind when the window is occluded and restored. The
 * "destroy" variant reproduces WebGpuCanvasPool's reclaim (unconfigure, 1x1, remove, drop).
 */
async function canvasProbe(run: Run) {
  const { params, host } = run.context;
  const variant = params.get("variant") ?? "destroy";
  const mode = params.get("mode") ?? "orderout";
  const cycles = number(params, "cycles", 20);
  const hiddenMs = number(params, "hiddenMs", 3000);
  const visibleMs = number(params, "visibleMs", 2000);
  const resizeSteps = number(params, "resizeSteps", 8);
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU adapter unavailable");
  let device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  const width = Math.round(host.clientWidth * devicePixelRatio);
  const height = Math.round(host.clientHeight * devicePixelRatio);
  const webgl = variant.startsWith("webgl-");
  // Assigned from several closures; the casts stop control-flow narrowing to `null`.
  let canvas = null as HTMLCanvasElement | null;
  let context = null as GPUCanvasContext | null;
  let gl = null as WebGL2RenderingContext | null;
  let configured = false;
  let lastTexture = null as GPUTexture | null;
  let frame = 0;
  let timer = null as ReturnType<typeof setInterval> | null;
  const mount = () => {
    if (!canvas || !(webgl ? gl : context)) {
      canvas = document.createElement("canvas");
      canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
      if (webgl) {
        gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
        if (!gl) throw new Error("WebGL2 context unavailable");
      } else {
        context = canvas.getContext("webgpu");
        if (!context) throw new Error("WebGPU canvas context unavailable");
      }
      configured = false;
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (!canvas.isConnected) host.append(canvas);
    if (!webgl && context && !configured) {
      context.configure({ device, format, alphaMode: "opaque" });
      configured = true;
    }
  };
  const draw = () => {
    if (webgl) {
      if (!gl) return;
      gl.clearColor((frame++ % 255) / 255, 0.2, 0.3, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.flush();
      return;
    }
    if (!context) return;
    lastTexture = context.getCurrentTexture();
    const encoder = device.createCommandEncoder();
    encoder
      .beginRenderPass({
        colorAttachments: [
          {
            view: lastTexture.createView(),
            clearValue: { r: (frame++ % 255) / 255, g: 0.2, b: 0.3, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      })
      .end();
    device.queue.submit([encoder.finish()]);
  };
  const startFrames = () => {
    draw();
    timer = setInterval(draw, 33);
  };
  const stopFrames = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const release = async () => {
    if (!canvas || !(webgl ? gl : context)) return;
    switch (variant) {
      case "destroy": // WebGpuCanvasPool.destroy: unconfigure, shrink to 1x1, remove, drop.
        context?.unconfigure();
        canvas.width = 1;
        canvas.height = 1;
        canvas.remove();
        canvas = null;
        context = null;
        configured = false;
        break;
      case "destroy-texture": // as destroy, but also destroys the last canvas texture first
        lastTexture?.destroy();
        context?.unconfigure();
        canvas.width = 1;
        canvas.height = 1;
        canvas.remove();
        canvas = null;
        context = null;
        configured = false;
        break;
      case "remove-only":
        canvas.remove();
        canvas = null;
        context = null;
        configured = false;
        break;
      case "unconfigure-only": // drop the element without shrinking it
        context?.unconfigure();
        canvas.remove();
        canvas = null;
        context = null;
        configured = false;
        break;
      case "shrink-keep": // keep element and configuration, release the large backing
        canvas.width = 1;
        canvas.height = 1;
        break;
      case "unconfigure-keep": // keep the element, drop its configuration
        context?.unconfigure();
        configured = false;
        break;
      case "hide-keep": // keep everything configured at full size, just hide
        canvas.style.visibility = "hidden";
        break;
      case "detach-keep": // WebGpuCanvasPool idle state: out of the DOM, still configured and sized
        canvas.style.visibility = "hidden";
        canvas.remove();
        break;
      case "resize-live": // nothing on release; resizes happen while visible (see resizeLive)
        break;
      case "reconfigure": {
        // Device change: keep the element, point its context at a new device, retire the old one.
        const previous = device;
        device = await adapter.requestDevice();
        configured = false;
        lastTexture = null;
        previous.destroy();
        canvas.style.visibility = "hidden";
        break;
      }
      case "webgl-destroy": // WebGlCellRenderer.dispose: remove, lose the context, shrink, drop.
        canvas.remove();
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
        canvas.width = 1;
        canvas.height = 1;
        canvas = null;
        gl = null;
        break;
      case "webgl-keep":
        canvas.style.visibility = "hidden";
        break;
      default:
        throw new Error(`Unknown canvas variant ${variant}`);
    }
    lastTexture = null;
  };
  // Live backing-store resizes with frames running (a drag resize / pane relayout), ending at the
  // original size. Every step differs from its predecessor by more than the pool's slack.
  const resizeLive = async () => {
    if (variant !== "resize-live" || !canvas) return;
    const widths = [width - 160, width - 40, width - 300, width - 90, width - 220, width - 10, width - 130, width];
    const heights = [height - 100, height - 20, height - 190, height - 60, height - 140, height - 5, height - 80, height];
    for (let step = 0; step < resizeSteps && canvas; step++) {
      canvas.width = widths[step % widths.length];
      canvas.height = heights[step % heights.length];
      await pause(100);
    }
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
    }
  };
  await native("show", { mode: "orderout" }); // ensure the window is key and active
  mount();
  startFrames();
  await pause(3000);
  await sync(run, "setup", { variant, mode, cycles, hiddenMs, visibleMs });
  await pause(2000);
  await sync(run, "baseline", { cycle: 0 });
  // mode "none" never touches the window: it shows the teardown leak is not specific to occlusion.
  const visibleWindow = mode === "none";
  for (let cycle = 1; cycle <= cycles; cycle++) {
    const hide = visibleWindow
      ? { ok: true, occluded: false, mode, focus: await native("show", { mode: "orderout" }) }
      : await native("hide", { mode });
    stopFrames();
    await release();
    await native("sleep", { ms: hiddenMs });
    await sync(run, `cycle-${cycle}-hidden`, { cycle, step: "hidden", hide, variant });
    const show = visibleWindow
      ? { ok: true, visible: true, key: true, active: true, mode }
      : await native("show", { mode });
    if (canvas) canvas.style.visibility = "visible";
    mount();
    startFrames();
    await resizeLive();
    await pause(visibleMs);
    await sync(run, `cycle-${cycle}-visible`, { cycle, step: "visible", show, variant });
  }
  stopFrames();
  await sync(run, "cycles-complete");
  await pause(10_000);
  await sync(run, "end+10s");
  await pause(20_000);
  await sync(run, "end+30s");
  const gcKind = (params.get("gc") ?? "none") as GcKind;
  if (gcKind !== "none") {
    const gc = await attemptGc(gcKind, 1500);
    await sync(run, "post-gc+2s", { gc });
    await pause(8000);
    await sync(run, "post-gc+10s");
  }
}

/**
 * Alternates between a one-pane tab and a four-pane tab, dwelling on each longer than the old
 * two second idle-canvas deadline, so every return needs canvases that an expiring pool would
 * have destroyed. Footprint is sampled after each full round trip.
 */
async function tabs(run: Run) {
  const { params } = run.context;
  const cycles = number(params, "cycles", 20);
  const dwellMs = number(params, "dwellMs", 3000);
  // "hide-first": the outgoing tab releases before the incoming one asks for canvases.
  // "show-first": the other way round, which the app hits whenever the tab it switches to comes
  // earlier in the React tree than the one it leaves (effects run in tree order).
  const showFirst = params.get("order") === "show-first";
  const show = (group: number) => {
    const hide = () => {
      for (const pane of run.panes) if (pane.group !== group) pane.surface.setVisible(false);
    };
    const reveal = () => {
      for (const pane of run.panes) if (pane.group === group) pane.surface.setVisible(true);
    };
    if (showFirst) {
      reveal();
      hide();
    } else {
      hide();
      reveal();
    }
  };
  await native("show", { mode: "orderout" }); // ensure the window is key and active
  startAgents(run, 250, 500);
  await pause(3000);
  await sync(run, "setup", { cycles, dwellMs, order: showFirst ? "show-first" : "hide-first" });
  await pause(2000);
  await sync(run, "baseline", { cycle: 0 });
  for (let cycle = 1; cycle <= cycles; cycle++) {
    show(1);
    await pause(dwellMs);
    show(0);
    await pause(dwellMs);
    await sync(run, `cycle-${cycle}-visible`, { cycle, step: "visible" });
  }
  await sync(run, "cycles-complete");
  await pause(10_000);
  await sync(run, "end+10s");
  await pause(20_000);
  await sync(run, "end+30s");
}

async function move(run: Run) {
  const { params } = run.context;
  const steps = number(params, "steps", 200);
  const jumps = number(params, "jumps", 50);
  const stepPoints = number(params, "stepPoints", 3);
  const intervalMs = number(params, "stepIntervalMs", 16);
  const jumpPauseMs = number(params, "jumpPauseMs", 200);
  await native("show", { mode: "orderout" }); // ensure the window is key and active
  startAgents(run, 250, 500);
  await pause(3000);
  await sync(run, "setup", { steps, jumps, stepPoints, intervalMs, jumpPauseMs });
  await pause(2000);
  await sync(run, "baseline");
  const origin = (await native("snapshot")).frame as number[];
  // 200 small steps: out to the right and back, in chunks so memory is sampled while moving.
  const chunk = Math.max(1, Math.floor(steps / 4));
  for (let index = 0; index < 4; index++) {
    const direction = index < 2 ? 1 : -1;
    await native("moveSteps", {
      dx: stepPoints * direction,
      dy: direction,
      count: chunk,
      intervalMs,
    });
    await sync(run, `steps-${(index + 1) * chunk}`, { step: "steps" });
  }
  await pause(1500);
  await sync(run, "steps-settled");
  // Jumps between two fixed positions, pausing between moves like repeated window placement.
  const positions = [
    [origin[0], origin[1]],
    [origin[0] + 300, origin[1] - 120],
  ];
  for (let index = 1; index <= jumps; index++) {
    const [x, y] = positions[index % 2];
    await native("moveTo", { x, y });
    await pause(jumpPauseMs);
    if (index % Math.max(1, Math.floor(jumps / 2)) === 0)
      await sync(run, `jumps-${index}`, { step: "jumps" });
  }
  await native("moveTo", { x: origin[0], y: origin[1] });
  await pause(1500);
  await sync(run, "jumps-settled");
  await pause(10_000);
  await sync(run, "settle+10s");
  await pause(20_000);
  await sync(run, "settle+30s");
}

/**
 * Window drag-resize like a user dragging the bottom-right corner: shrink then grow back, several
 * times, with output streaming and scrollback to reflow. Footprint is sampled after every half.
 */
async function resize(run: Run) {
  const { params } = run.context;
  const cycles = number(params, "cycles", 3);
  const steps = number(params, "steps", 120);
  const stepPoints = number(params, "stepPoints", 4);
  const intervalMs = number(params, "stepIntervalMs", 16);
  const live = (params.get("resizeMode") ?? "live") === "live";
  const scrollbackLines = number(params, "scrollbackLines", 3000);
  await native("show", { mode: "orderout" }); // ensure the window is key and active
  const encoder = new TextEncoder();
  for (const pane of run.panes) {
    let text = "";
    for (let line = 0; line < scrollbackLines; line++) {
      text += `\x1b[3${line % 8}m${String(line).padStart(6, "0")}\x1b[0m lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ${line}\r\n`;
      if (text.length > 64 * 1024) {
        pane.model.write(encoder.encode(text));
        text = "";
      }
    }
    if (text) pane.model.write(encoder.encode(text));
  }
  startAgents(run, 250, 500);
  await pause(3000);
  await sync(run, "setup", { cycles, steps, stepPoints, intervalMs, live, scrollbackLines });
  await pause(2000);
  await sync(run, "baseline");
  for (let cycle = 1; cycle <= cycles; cycle++) {
    await native("resizeSteps", { dw: -stepPoints, dh: -stepPoints / 2, count: steps, intervalMs, live });
    await sync(run, `shrink-${cycle}`, { cycle });
    await native("resizeSteps", { dw: stepPoints, dh: stepPoints / 2, count: steps, intervalMs, live });
    await sync(run, `grow-${cycle}`, { cycle });
    // Idle terminals present nothing after a drag; this shows what WebKit keeps without frames.
    if (cycle === cycles && params.get("idleAfter") === "1") stopAgents(run);
  }
  await pause(1500);
  await sync(run, "resize-settled");
  await pause(10_000);
  await sync(run, "settle+10s");
  await pause(20_000);
  await sync(run, "settle+30s");
  stopAgents(run);
}

async function agentsOrIdle(run: Run, idle: boolean) {
  const { params } = run.context;
  const duration = number(params, "duration", idle ? 30 : 60) * 1000;
  const warmup = number(params, "warmup", 5) * 1000;
  const tick = number(params, "tick", 0) * 1000;
  const hidden = number(params, "hidden", 8);
  await native("show", { mode: "orderout" }); // ensure the window is key and active
  await pause(3000);
  await sync(run, "setup-complete", { hiddenModels: hidden, idle });
  if (!idle) startAgents(run, 80, 50);
  await pause(warmup);
  run.heartbeats.length = 0;
  const stopHeartbeat = startHeartbeat(run, 5000);
  await sync(run, "measure-start", { durationMs: duration });
  const start = performance.now();
  const end = start + duration;
  let ticks = 0;
  // Optional intermediate samples (footprint calls perturb the target slightly; off by default).
  while (tick > 0 && performance.now() + tick < end) {
    await pause(tick);
    await sync(run, `measure-tick-${++ticks}`);
  }
  await pause(Math.max(0, end - performance.now()));
  stopHeartbeat();
  await sync(run, "measure-end", { elapsedMs: performance.now() - start });
  stopAgents(run);
  await pause(2000);
  await sync(run, "after-stop");
}

export async function runNamedWorkload(name: string, context: LabContext): Promise<void> {
  const failure = (error: unknown) =>
    context.report("error", { error: String(error), stack: (error as Error)?.stack });
  // Instrumentation patches DOM/WebGPU prototypes; run with instrument=0 to confirm it does not
  // change the measured memory behaviour. Off by default for the CPU/energy workloads.
  // Renderer tuning knob (renderers that predate it ignore it): idle canvas parking delay.
  const parkMs = context.params.get("parkMs");
  if (parkMs !== null) localStorage.setItem("terax:terminal-canvas-park-ms", parkMs);
  const instrument =
    context.params.get("instrument") ??
    (["occlusion", "move", "resize", "canvas", "tabs"].includes(name) ? "1" : "0");
  if (instrument === "1") installCanvasInstrumentation();
  context.report("blank");
  await pause(3000);
  const run: Run = { context, panes: [], agents: [], heartbeats: [], syncId: 0 };
  const blink = context.params.get("blink") !== "0";
  switch (name) {
    case "occlusion":
    case "move":
    case "resize":
      // `--no-gpu` (resize): a control that drags the same window with an empty page, to show what
      // WebKit's live resize costs by itself.
      run.panes =
        name === "resize" && context.params.get("noGpu") === "1"
          ? []
          : await buildTabs(context, blink, failure);
      break;
    case "tabs":
      run.panes = await buildMixedTabs(context, blink, failure);
      break;
    case "agents":
    case "idle":
      run.panes = await buildAgents(context, number(context.params, "hidden", 8), blink, failure);
      break;
    case "canvas":
      break;
    default:
      throw new Error(`Unknown workload ${name}`);
  }
  if (name === "occlusion") await occlusion(run);
  else if (name === "canvas") await canvasProbe(run);
  else if (name === "move") await move(run);
  else if (name === "resize") await resize(run);
  else if (name === "tabs") await tabs(run);
  else await agentsOrIdle(run, name === "idle");
  stopAgents(run);
  context.report("done");
}
