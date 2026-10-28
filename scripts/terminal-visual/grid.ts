/*
 * Split-pane variant of the visual harness: R x C real surfaces share the one window canvas,
 * separated by DOM dividers, each showing the same edge-heavy grid pattern. A capture reads the
 * whole canvas back; `compare.mjs grid` then checks that every pane equals a single pane of the
 * same size (pixel exact, nothing bleeding across the scissor edges) and that everything else is
 * one background colour and the dividers sit exactly between the panes.
 *
 * Query: grid=RxC (2x2), gap=<css px divider> (1), w h left top (the grid box, CSS px),
 * exact=1 (size every pane to a whole number of cells so no slack separates glyph overhang
 * from the scissor edge), cols rows (pane size in cells with exact=1), dpr, fs, capture=name.
 */
import "@/styles/fonts.css";

const params = new URLSearchParams(location.search);
let fakeRatio = Number(params.get("dpr"));
if (fakeRatio > 0) {
  Object.defineProperty(window, "devicePixelRatio", {
    get: () => fakeRatio,
    configurable: true,
  });
  // The engine's device-pixel boxes belong to the real ratio, not the faked one: observe the
  // content box only, so every size derives from the faked ratio.
  const observe = ResizeObserver.prototype.observe;
  ResizeObserver.prototype.observe = function (target, options) {
    return observe.call(this, target, options?.box === "device-pixel-content-box" ? undefined : options);
  };
}
(window as unknown as { __setDpr: (value: number) => void }).__setDpr = (value) => {
  fakeRatio = value;
  window.dispatchEvent(new Event("resize"));
};
if (params.get("raf") !== "native") {
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(performance.now()), 16);
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
}

type Readback = { device: GPUDevice | null; texture: GPUTexture | null; pending: Array<(texture: GPUTexture) => void> };
const readback: Readback = { device: null, texture: null, pending: [] };
{
  const requestDevice = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (descriptor) {
    const device = await requestDevice.call(this, descriptor);
    readback.device = device;
    return device;
  };
  const proto = GPUCanvasContext.prototype;
  const configure = proto.configure;
  proto.configure = function (config) {
    return configure.call(this, {
      ...config,
      usage: (config.usage ?? GPUTextureUsage.RENDER_ATTACHMENT) | GPUTextureUsage.COPY_SRC,
    });
  };
  const getCurrentTexture = proto.getCurrentTexture;
  proto.getCurrentTexture = function () {
    const texture = getCurrentTexture.call(this);
    readback.texture = texture;
    return texture;
  };
  const submit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (buffers) {
    submit.call(this, buffers);
    const waiting = readback.pending.splice(0);
    if (waiting.length > 0 && readback.texture) for (const resolve of waiting) resolve(readback.texture);
  };
}

const [{ getGhosttyCoreRuntime }, { WebGpuTerminalSurface }, terminalVisuals, fonts, runtimeModule] =
  await Promise.all([
    import("@/modules/terminal/ghostty/GhosttyCoreRuntime"),
    import("@/modules/terminal/ghostty/gpu/WebGpuTerminalSurface"),
    import("@/modules/terminal/ghostty/gpu/terminalVisuals"),
    import("@/lib/fonts"),
    import("@/modules/terminal/ghostty/gpu/WebGpuTerminalRuntime"),
  ]);

const number = (key: string, fallback: number) => {
  const value = Number(params.get(key));
  return params.has(key) && Number.isFinite(value) ? value : fallback;
};
const [gridRows, gridCols] = (params.get("grid") ?? "2x2").split("x").map(Number);
const gap = number("gap", 1);
const grid = document.querySelector("#grid") as HTMLElement;
const info = document.querySelector("#info") as HTMLElement;
const stageEl = document.querySelector("#stage") as HTMLElement;
stageEl.style.setProperty("--area-width", `${number("aw", 1600)}px`);
stageEl.style.setProperty("--area-height", `${number("ah", 1000)}px`);
grid.style.setProperty("--grid-left", `${number("left", 0)}px`);
grid.style.setProperty("--grid-top", `${number("top", 0)}px`);

const PALETTE = [
  [0x1b, 0x1d, 0x1f], [0xe0, 0x55, 0x55], [0x6f, 0xc3, 0x6f], [0xe5, 0xc0, 0x7b],
  [0x61, 0xaf, 0xef], [0xc6, 0x78, 0xdd], [0x56, 0xb6, 0xc2], [0xd0, 0xd4, 0xd9],
  [0x5c, 0x63, 0x70], [0xff, 0x6b, 0x6b], [0x8e, 0xe0, 0x8e], [0xff, 0xdf, 0x8e],
  [0x82, 0xc4, 0xff], [0xe0, 0x9b, 0xf5], [0x7e, 0xdc, 0xe6], [0xff, 0xff, 0xff],
] as const;
const theme = {
  background: [0x16, 0x18, 0x1b],
  foreground: [0xd0, 0xd4, 0xd9],
  cursor: [0xf0, 0xc0, 0x40],
  selection: { color: [0x50, 0x80, 0xc0], alpha: 0.45 },
  palette: PALETTE,
} as const;
const pack = (color: readonly number[]) => (color[0] << 16) | (color[1] << 8) | color[2];
const font = {
  family: params.get("ff") ?? '"JetBrains Mono", SFMono-Regular, Menlo, monospace',
  size: number("fs", 14),
  lineHeight: number("lh", 1.2),
  letterSpacing: 0,
  weight: "400",
};

await fonts.ensureMonoFontsLoaded();
await document.fonts.ready;
const metrics = await terminalVisuals.measureTerminalFont(font);
const scale = window.devicePixelRatio;

// Pane size in CSS pixels: a whole number of cells with exact=1, else an equal share of the box.
let paneWidth: number;
let paneHeight: number;
if (params.get("exact") === "1") {
  paneWidth = (number("cols", 40) * metrics.deviceCellWidth) / scale;
  paneHeight = (number("rows", 12) * metrics.deviceCellHeight) / scale;
} else {
  paneWidth = (number("w", 1000) - gap * (gridCols - 1)) / gridCols;
  paneHeight = (number("h", 640) - gap * (gridRows - 1)) / gridRows;
}
grid.style.setProperty("--grid-width", `${paneWidth * gridCols + gap * (gridCols - 1)}px`);
grid.style.setProperty("--grid-height", `${paneHeight * gridRows + gap * (gridRows - 1)}px`);

const core = getGhosttyCoreRuntime();
const encoder = new TextEncoder();
const panes: Array<{
  host: HTMLElement;
  surface: InstanceType<typeof WebGpuTerminalSurface>;
  write: (text: string) => void;
}> = [];
const dividers: HTMLElement[] = [];
for (let row = 0; row < gridRows; row += 1) {
  for (let col = 0; col < gridCols; col += 1) {
    const host = document.createElement("div");
    host.className = "pane";
    host.style.cssText = `left:${col * (paneWidth + gap)}px;top:${row * (paneHeight + gap)}px;width:${paneWidth}px;height:${paneHeight}px`;
    grid.append(host);
    const model = await core.createModel({
      leafId: row * gridCols + col + 1,
      backend: "ghostty-webgpu",
      cols: 40,
      rows: 12,
      config: {
        scrollbackLimit: 100,
        fgColor: pack(theme.foreground),
        bgColor: pack(theme.background),
        cursorColor: pack(theme.cursor),
        palette: PALETTE.map(pack),
        cursorStyle: "block",
        cursorBlink: false,
      },
    });
    const surface = await WebGpuTerminalSurface.create({
      model,
      metrics,
      theme: theme as never,
      cursorBlink: false,
      cursorStyle: "block",
      onResize: () => {},
      onError: (error: Error) => {
        info.textContent = `error: ${error.message}`;
        console.error(error);
      },
    });
    surface.attach(host);
    surface.setVisible(true);
    surface.setFocused(false);
    panes.push({ host, surface, write: (text) => model.write(encoder.encode(text)) });
  }
}
for (let row = 0; row < gridRows; row += 1) {
  for (let col = 1; col < gridCols; col += 1) {
    const divider = document.createElement("div");
    divider.className = "divider";
    divider.style.cssText = `left:${col * (paneWidth + gap) - gap}px;top:${row * (paneHeight + gap)}px;width:${gap}px;height:${paneHeight}px`;
    grid.append(divider);
    dividers.push(divider);
  }
}
for (let row = 1; row < gridRows; row += 1) {
  const divider = document.createElement("div");
  divider.className = "divider";
  divider.style.cssText = `left:0;top:${row * (paneHeight + gap) - gap}px;width:${paneWidth * gridCols + gap * (gridCols - 1)}px;height:${gap}px`;
  grid.append(divider);
  dividers.push(divider);
}

const frames = (count = 2) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(count);
  });
async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await frames(2);
    const pending = panes.reduce(
      (sum, pane) => sum + ((pane.surface.diagnostics() as { pendingGlyphs?: number }).pendingGlyphs ?? 0),
      0,
    );
    if (pending === 0) break;
  }
  await frames(3);
}

/** Every cell carries something: coloured edge cells with overhanging italic glyphs, text inside. */
function gridPattern(cols: number, rows: number): string {
  const esc = "\x1b[";
  let out = `${esc}?25l${esc}2J${esc}H`;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const edge = c === 0 || c === cols - 1 || r === 0 || r === rows - 1;
      if (edge) {
        const glyph = c === 0 ? "j" : c === cols - 1 ? "f" : "W";
        out += `${esc}3;1;97;4${1 + ((r + c) % 6)}m${glyph}${esc}0m`;
      } else {
        const glyph = "fjgyMW|/_=#"[(r * 7 + c * 3) % 11];
        out += `${esc}3${1 + ((r + c) % 7)}m${(r + c) % 5 === 0 ? esc + "4m" : ""}${glyph}${esc}0m`;
      }
    }
    if (r < rows - 1) out += "\r\n";
  }
  return out;
}

await settle();
for (const pane of panes) {
  const stats = pane.surface.diagnostics() as unknown as { cols: number; rows: number };
  pane.write(gridPattern(stats.cols, stats.rows));
}
await settle();

async function captureCanvas() {
  const wait = new Promise<GPUTexture>((resolve) => readback.pending.push(resolve));
  panes[0].surface.setTheme(theme as never);
  const texture = await wait;
  const device = readback.device as GPUDevice;
  const bytesPerRow = Math.ceil((texture.width * 4) / 256) * 256;
  const buffer = device.createBuffer({
    size: bytesPerRow * texture.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const commands = device.createCommandEncoder();
  commands.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [texture.width, texture.height]);
  device.queue.submit([commands.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const source = new Uint8Array(buffer.getMappedRange());
  const rgba = new Uint8Array(texture.width * texture.height * 4);
  const bgra = texture.format.startsWith("bgra");
  for (let y = 0; y < texture.height; y += 1) {
    for (let x = 0; x < texture.width; x += 1) {
      const from = y * bytesPerRow + x * 4;
      const to = (y * texture.width + x) * 4;
      rgba[to] = source[from + (bgra ? 2 : 0)];
      rgba[to + 1] = source[from + 1];
      rgba[to + 2] = source[from + (bgra ? 0 : 2)];
      rgba[to + 3] = 255;
    }
  }
  buffer.unmap();
  buffer.destroy();
  return { width: texture.width, height: texture.height, rgba };
}

async function post(name: string, body: BodyInit): Promise<void> {
  const response = await fetch(`/__save/${name}`, { method: "POST", body });
  if (!response.ok) throw new Error(`save ${name} failed`);
}

const stage = document.querySelector("#stage") as HTMLElement;
function describe() {
  const area = stage.getBoundingClientRect();
  const origin = { x: Math.round(area.left * scale), y: Math.round(area.top * scale) };
  const rectOf = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const x0 = Math.round(rect.left * scale) - origin.x;
    const y0 = Math.round(rect.top * scale) - origin.y;
    const x1 = Math.round(rect.right * scale) - origin.x;
    const y1 = Math.round(rect.bottom * scale) - origin.y;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };
  return {
    dpr: window.devicePixelRatio,
    clear: theme.background,
    cell: { width: metrics.deviceCellWidth, height: metrics.deviceCellHeight },
    panes: panes.map((pane) => {
      const stats = pane.surface.diagnostics() as unknown as {
        viewport: unknown;
        cols: number;
        rows: number;
      };
      return { viewport: stats.viewport, cols: stats.cols, rows: stats.rows, host: rectOf(pane.host) };
    }),
    dividers: dividers.map(rectOf),
    runtime: runtimeModule.webGpuTerminalRuntimeDiagnostics()?.canvases,
  };
}

const api = {
  panes,
  settle,
  frames,
  describe,
  async capture(name: string) {
    await settle();
    const image = await captureCanvas();
    const meta = { name, width: image.width, height: image.height, ...describe() };
    await post(`${name}.rgba`, image.rgba);
    await post(`${name}.json`, JSON.stringify(meta));
    return meta;
  },
};
(window as unknown as { harness: typeof api }).harness = api;
info.textContent = `dpr ${window.devicePixelRatio}  ${gridRows}x${gridCols} panes  pane ${paneWidth.toFixed(2)}x${paneHeight.toFixed(2)} css`;
document.title = "harness ready";
const autoCapture = params.get("capture");
if (autoCapture) {
  await api.capture(autoCapture);
  document.title = `captured ${autoCapture}`;
}
