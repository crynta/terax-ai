/*
 * Standalone renderer harness: draws a fixed test pattern through the real
 * WebGPU surface and the real Ghostty model, and can read the presented canvas
 * back as exact RGBA. The same page runs against any source tree
 * (TERAX_VISUAL_SOURCE_ROOT), which is how two renderer versions are compared.
 * See README.md for the query parameters and workflow.
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
// Lets a test change the ratio live, as dragging between displays would.
(window as unknown as { __setDpr: (value: number) => void }).__setDpr = (value) => {
  fakeRatio = value;
  window.dispatchEvent(new Event("resize"));
};

// A pane that is not on screen never fires requestAnimationFrame, which stalls
// the renderer. Timers keep it running so captures work headlessly.
if (params.get("raf") !== "native") {
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(performance.now()), 16);
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
}

type ReadbackState = {
  device: GPUDevice | null;
  texture: GPUTexture | null;
  pending: Array<(texture: GPUTexture) => void>;
};
const readback: ReadbackState = { device: null, texture: null, pending: [] };

function installReadbackHooks(): void {
  const requestDevice = GPUAdapter.prototype.requestDevice;
  const textureLimit = Number(params.get("maxtex"));
  GPUAdapter.prototype.requestDevice = async function (descriptor) {
    const device = await requestDevice.call(this, descriptor);
    readback.device = device;
    if (textureLimit > 0) {
      // Lets the atlas hit its capacity at a small size, to exercise eviction.
      Object.defineProperty(device, "limits", {
        value: { maxTextureDimension2D: textureLimit },
      });
    }
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
    if (waiting.length > 0 && readback.texture) {
      for (const resolve of waiting) resolve(readback.texture);
    }
  };
}
if ("gpu" in navigator) installReadbackHooks();

// The WebGL renderer clears its drawing buffer after presenting; keeping it lets
// the harness read the last frame back with readPixels.
let webglContext: WebGL2RenderingContext | null = null;
{
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    kind: string,
    options?: unknown,
  ) {
    const context = getContext.call(
      this,
      kind as "webgl2",
      kind === "webgl2"
        ? { ...(options as object), preserveDrawingBuffer: true }
        : (options as WebGLContextAttributes),
    );
    if (kind === "webgl2") webglContext = context as WebGL2RenderingContext;
    return context;
  } as typeof getContext;
}

const [
  { getGhosttyCoreRuntime },
  { WebGpuTerminalSurface },
  terminalVisuals,
  fonts,
] = await Promise.all([
  import("@/modules/terminal/ghostty/GhosttyCoreRuntime"),
  import("@/modules/terminal/ghostty/gpu/WebGpuTerminalSurface"),
  import("@/modules/terminal/ghostty/gpu/terminalVisuals"),
  import("@/lib/fonts"),
]);

// Progress marker for debugging a page that never becomes ready.
const stage = (name: string) => {
  (window as unknown as { __stage: string }).__stage = name;
};
const host = document.querySelector("#host") as HTMLElement;
const info = document.querySelector("#info") as HTMLElement;
const number = (key: string, fallback: number) => {
  const value = Number(params.get(key));
  return params.has(key) && Number.isFinite(value) ? value : fallback;
};
const stageElement = document.querySelector("#stage") as HTMLElement;
stageElement.style.setProperty("--area-width", `${number("aw", 1600)}px`);
stageElement.style.setProperty("--area-height", `${number("ah", 1000)}px`);
host.style.setProperty("--host-width", `${number("w", 1000)}px`);
host.style.setProperty("--host-height", `${number("h", 640)}px`);
host.style.setProperty("--host-left", `${number("left", 0)}px`);
host.style.setProperty("--host-top", `${number("top", 0)}px`);

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
  family:
    params.get("ff") ?? '"JetBrains Mono", SFMono-Regular, Menlo, monospace',
  size: number("fs", 14),
  lineHeight: number("lh", 1.2),
  letterSpacing: number("ls", 0),
  weight: "400",
};

stage("fonts");
await fonts.ensureMonoFontsLoaded();
await document.fonts.ready;
stage("measure");
const metrics = await terminalVisuals.measureTerminalFont(font);
stage("model");
const core = getGhosttyCoreRuntime();
const model = await core.createModel({
  leafId: 1,
  backend: "ghostty-webgpu",
  cols: 100,
  rows: 30,
  config: {
    scrollbackLimit: 2000,
    fgColor: pack(theme.foreground),
    bgColor: pack(theme.background),
    cursorColor: pack(theme.cursor),
    palette: PALETTE.map(pack),
    cursorStyle: (params.get("cursor") as "block" | "bar" | "underline") ?? "block",
    cursorBlink: params.get("blink") === "1",
  },
});
stage("surface");
const surfaceOptions = {
  model,
  metrics,
  theme: theme as never,
  cursorBlink: params.get("blink") === "1",
  cursorStyle: (params.get("cursor") as "block" | "bar" | "underline") ?? "block",
  onResize: () => {},
  onError: (error: Error) => {
    info.textContent = `error: ${error.message}`;
    console.error(error);
  },
};
async function createSurface(kind: string) {
  if (kind === "webgl") {
    const { WebGlTerminalSurface } = await import(
      "@/modules/terminal/ghostty/webgl/WebGlTerminalSurface"
    );
    return new WebGlTerminalSurface(surfaceOptions) as unknown as Awaited<
      ReturnType<typeof WebGpuTerminalSurface.create>
    >;
  }
  return WebGpuTerminalSurface.create(surfaceOptions);
}
let surfaceKind = params.get("renderer") ?? "webgpu";
let surface = await createSurface(surfaceKind);
stage("attach");
surface.attach(host);
surface.setVisible(true);
surface.setFocused(true);

const encoder = new TextEncoder();
const write = (text: string) => model.write(encoder.encode(text));
const frames = (count = 2) =>
  new Promise<void>((resolve) => {
    const step = (left: number) =>
      left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
    step(count);
  });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pattern(): string {
  const esc = "\x1b[";
  const lines: string[] = [];
  const colored = (code: string, text: string) => `${esc}${code}m${text}${esc}0m`;
  lines.push(
    `${colored("1;38;5;81", "Terax renderer harness")}  dpr=${window.devicePixelRatio} font=${font.size}px`,
  );
  lines.push(" !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~");
  lines.push(`regular: The quick brown fox jumps over the lazy dog 0123456789 {}[]()<>`);
  lines.push(`${colored("1", "bold:    The quick brown fox jumps over the lazy dog 0123456789 {}[]()<>")}`);
  lines.push(`${colored("3", "italic:  The quick brown fox jumps over the lazy dog 0123456789 {}[]()<>")}`);
  lines.push(`${colored("1;3", "bold-it: The quick brown fox jumps over the lazy dog 0123456789 {}[]()<>")}`);
  lines.push("┌──┬──┐ ╔══╦══╗ ╭──╮  ├──┼──┤ ║  ║  ║ │  │  │  └──┴──┘ ╚══╩══╝ ╰──╯  ▀▄█▌▐ ░▒▓ ▁▂▃▄▅▆▇█");
  lines.push("│ box ││ box │  ┃ heavy ┃  ┏━━┓  ┗━━┛   ◢◣◤◥  ⣿⣷⣯  ← ↑ → ↓  ✓ ✗ ★ ☆");
  lines.push(
    [
      colored("4", "single"),
      colored("4:2", "double"),
      colored("4:3", "curly"),
      colored("4:4", "dotted"),
      colored("4:5", "dashed"),
      colored("4;58;2;255;90;90", "red-line"),
      colored("4:3;58;2;90;220;120", "green-curly"),
      colored("9", "strike"),
      colored("53", "overline"),
      colored("4;9;53", "all-three"),
    ].join("  "),
  );
  lines.push(
    [
      colored("2", "faint text"),
      colored("5", "blinking"),
      colored("7", "inverse"),
      colored("8", "invisible") + "(<-hidden)",
      colored("1;7", "bold-inv"),
      colored("31;47", "red-on-white"),
      colored("97;44", "white-on-blue"),
      colored("2;4", "faint-underline"),
    ].join("  "),
  );
  let fg = "";
  let bg = "";
  for (let i = 0; i < 8; i += 1) {
    fg += colored(`3${i}`, "ab ") + colored(`9${i}`, "ab ");
    bg += colored(`4${i}`, "  ") + colored(`10${i}`, "  ");
  }
  lines.push(`${fg}${bg}`);
  let strip = "";
  for (let i = 16; i < 52; i += 1) strip += colored(`48;5;${i}`, " ");
  for (let i = 196; i < 232; i += 1) strip += colored(`48;5;${i}`, " ");
  lines.push(strip);
  let ramp = "";
  for (let i = 0; i < 60; i += 1) {
    const v = Math.round((i / 59) * 255);
    ramp += colored(`48;2;${v};${255 - v};${Math.round(v / 2)};38;2;${255 - v};${v};255`, "x");
  }
  lines.push(ramp);
  lines.push("日本語のテキスト 你好，世界 한국어 テスト|ab|日本|cd| wide→" + colored("4:3;58;2;255;200;0", "日本語") + " " + colored("44", "日本") + colored("9", "語") + " " + colored("7", "反転"));
  lines.push("ｆｕｌｌｗｉｄｔｈ ＡＢＣ １２３  ｗ｜ａ｜ｄ  ｜日｜本｜ ｜i｜i｜");
  lines.push("emoji: 😀 🚀 ❤️ 👍🏽 👨‍👩‍👧 🇯🇵 🏳️‍🌈 ✅ ⭐  mixed: a😀b🚀c  " + colored("4", "😀😀") + colored("41", "🚀"));
  lines.push("combining: é ñ ü x̣̃ é̂ Å ǻ  ligature-ish: -> => != <= >= :: === !== ///");
  lines.push("overhang: j g y q p f ℓ ∫ ƒ  ij  AVAWAVA  " + colored("41", "fj") + colored("42", "jf") + colored("44", "ff") + " " + colored("1;3;41", "fff"));
  lines.push("needle in a haystack with needle and another NEEDLE, needle;needle");
  lines.push("selected line one: lorem ipsum dolor sit amet");
  lines.push("selected line two: consectetur adipiscing elit 日本語 end");
  lines.push("selected line three: sed do eiusmod tempor");
  lines.push("rect block A: 0123456789 0123456789 0123456789");
  lines.push("rect block B: abcdefghij abcdefghij abcdefghij");
  lines.push("cursor line> ");
  return lines.join("\r\n");
}

write("\x1b[2J\x1b[H");
if (params.get("stress")) {
  // Thousands of distinct glyphs, then the deterministic pattern again.
  // stress=2 waits for every page to be drawn (fills the atlas); stress=1
  // outpaces the renderer (exercises backlog shedding).
  let seed = 0;
  for (let page = 0; page < 10; page += 1) {
    let text = "\x1b[H";
    for (let index = 0; index < 1900; index += 1) {
      text += String.fromCodePoint(0x4e00 + seed++);
    }
    write(text);
    if (params.get("stress") === "2") await settle();
    else await sleep(120);
  }
  write("\x1b[2J\x1b[H");
}
const patternName = params.get("pattern") ?? "full";
if (patternName === "sprites") {
  const sprites = await import("./spritePattern");
  write(sprites.spriteAnsi());
} else if (patternName !== "empty") write(pattern());
const selectSpec = params.get("select");
const searchTerm = params.get("search");

stage("settle");
async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await frames(2);
    const pending = (surface.diagnostics() as { pendingGlyphs?: number }).pendingGlyphs ?? 0;
    if (pending === 0) break;
  }
  await frames(2);
}

function applySelection(spec: string): void {
  const [startRow, startCol, endRow, endCol, rect] = spec.split(",").map(Number);
  model.setSelection?.({
    anchor: { line: model.bufferLineAtViewportRow(startRow), column: startCol },
    focus: { line: model.bufferLineAtViewportRow(endRow), column: endCol },
    rectangular: rect === 1,
  });
}

if (selectSpec) applySelection(selectSpec);
if (searchTerm) surface.searchController().findNext(searchTerm);
await settle();

type Capture = { width: number; height: number; rgba: Uint8Array };

// Reads the pane's part of the window canvas in the most recent frame.
async function captureFrame(): Promise<Capture> {
  if (surfaceKind === "webgl") return captureWebGl();
  const wait = new Promise<GPUTexture>((resolve) => {
    readback.pending.push(resolve);
  });
  surface.setTheme(theme as never);
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
  // The canvas is shared by every pane of the window: keep the pane's grid area only, which is
  // what its own canvas held before the window canvas existed.
  const stats = surface.diagnostics() as unknown as {
    viewport: { x: number; y: number } | null;
    cols: number;
    rows: number;
  };
  const x0 = stats.viewport?.x ?? 0;
  const y0 = stats.viewport?.y ?? 0;
  const width = Math.min(texture.width - x0, stats.cols * metrics.deviceCellWidth);
  const height = Math.min(texture.height - y0, stats.rows * metrics.deviceCellHeight);
  const rgba = new Uint8Array(width * height * 4);
  const bgra = texture.format.startsWith("bgra");
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y0 + y) * bytesPerRow + (x0 + x) * 4;
      const to = (y * width + x) * 4;
      rgba[to] = source[from + (bgra ? 2 : 0)];
      rgba[to + 1] = source[from + 1];
      rgba[to + 2] = source[from + (bgra ? 0 : 2)];
      rgba[to + 3] = 255;
    }
  }
  buffer.unmap();
  buffer.destroy();
  return { width, height, rgba };
}

// Reads the WebGL renderer's last frame (top row first).
function captureWebGl(): Capture {
  const gl = webglContext;
  if (!gl) throw new Error("no WebGL context to read back");
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const flipped = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    rgba.set(
      flipped.subarray((height - 1 - y) * width * 4, (height - y) * width * 4),
      y * width * 4,
    );
  }
  for (let alpha = 3; alpha < rgba.length; alpha += 4) rgba[alpha] = 255;
  return { width, height, rgba };
}

async function post(name: string, body: BodyInit): Promise<void> {
  const response = await fetch(`/__save/${name}`, { method: "POST", body });
  if (!response.ok) throw new Error(`save ${name} failed`);
}

async function swapTo(kind: string): Promise<{ before: string; after: string }> {
  const before = model.renderFormat();
  const previous = surface;
  surface = await createSurface(kind);
  surfaceKind = kind;
  surface.attach(host);
  surface.setVisible(true);
  surface.setFocused(true);
  previous.dispose();
  await settle();
  return { before, after: model.renderFormat() };
}

const api = {
  get surface() {
    return surface;
  },
  swapTo,
  model,
  write,
  frames,
  sleep,
  settle,
  applySelection,
  async capture(name: string) {
    await settle();
    const result = await captureFrame();
    const meta = {
      name,
      width: result.width,
      height: result.height,
      dpr: window.devicePixelRatio,
      stats: surface.diagnostics(),
    };
    await post(`${name}.rgba`, result.rgba);
    await post(`${name}.json`, JSON.stringify(meta));
    return meta;
  },
  diagnostics: () => surface.diagnostics(),
  /**
   * Resizes the terminal area and the pane host together, like dragging the window edge, and
   * fires the window `resize` event (a hidden browser pane delivers no ResizeObserver callbacks).
   */
  async resizeTo(width: number, height: number) {
    stageElement.style.setProperty("--area-width", `${width + number("left", 0)}px`);
    stageElement.style.setProperty("--area-height", `${height + number("top", 0)}px`);
    host.style.setProperty("--host-width", `${width}px`);
    host.style.setProperty("--host-height", `${height}px`);
    window.dispatchEvent(new Event("resize"));
    await frames(3);
  },
  /** What the native live-resize notification does on macOS. */
  async gesture(active: boolean) {
    const module = await import("@/modules/terminal/lib/terminalResizeGesture");
    module.setNativeLiveResize(active);
    await frames(2);
  },
  /**
   * `pattern=sprites` only: measures line continuity across cell boundaries and,
   * when the revision has the procedural glyph generator, compares the frame
   * with the one it predicts. Saves `<name>.check.json`.
   */
  async spriteCheck(name: string) {
    await settle();
    const [sprites, check, frame] = await Promise.all([
      import("./spritePattern"),
      import("./spriteCheck"),
      captureFrame(),
    ]);
    const geometry = {
      cellWidth: metrics.deviceCellWidth,
      cellHeight: metrics.deviceCellHeight,
    };
    const rows = sprites.spriteRows();
    const report: Record<string, unknown> = {
      name,
      dpr: window.devicePixelRatio,
      renderer: surfaceKind,
      cell: `${geometry.cellWidth}x${geometry.cellHeight}`,
      seams: check.checkSeams(frame, rows, geometry),
    };
    // A glob, because a revision without the generator must still load.
    const loadBuiltin = Object.values(
      import.meta.glob("@/modules/terminal/ghostty/gpu/BuiltinGlyphs.ts"),
    )[0] as undefined | (() => Promise<Record<string, any>>);
    if (loadBuiltin) {
      const builtin = await loadBuiltin();
      const renderer = new builtin.BuiltinGlyphRenderer(
        builtin.builtinGlyphSpec(metrics),
      );
      report.thickness = renderer.spec.thickness;
      report.expected = check.checkExpected(frame, rows, geometry, (codepoint) =>
        renderer.render(codepoint),
      );
    } else {
      report.expected = null; // this revision draws these glyphs from the font
    }
    await post(`${name}.check.json`, JSON.stringify(report, null, 2));
    return report;
  },
  async runtime() {
    const module = await import("@/modules/terminal/ghostty/gpu/WebGpuTerminalRuntime");
    return module.webGpuTerminalRuntimeDiagnostics();
  },
};
(window as unknown as { harness: typeof api }).harness = api;
const stats = surface.diagnostics() as unknown as Record<string, number>;
info.textContent = `dpr ${window.devicePixelRatio}  ${stats.cols}x${stats.rows}  cell ${stats.deviceCellWidth ?? "?"}x${stats.deviceCellHeight ?? "?"} dev px`;
document.title = "harness ready";
const autoCapture = params.get("capture");
if (autoCapture) {
  await api.capture(autoCapture);
  if (patternName === "sprites") {
    (window as unknown as { __spriteCheck: unknown }).__spriteCheck =
      await api.spriteCheck(autoCapture);
  }
  document.title = `captured ${autoCapture}`;
}

// ?bench=spinner|rewrite|stream&ticks=N measures main-thread time per frame
// by driving prepareFrame and encode directly (no scheduler), after a warm-up.
const benchKind = params.get("bench");
if (benchKind) {
  const runtimeModule = await import("@/modules/terminal/ghostty/gpu/WebGpuTerminalRuntime");
  const runtime = await runtimeModule.getWebGpuTerminalRuntime();
  const resources = runtime.resources();
  // The scheduler must not render concurrently with the measured calls.
  window.requestAnimationFrame = () => 0;
  const ticks = number("ticks", 300);
  const warmup = 40;
  const rows = (surface.diagnostics() as unknown as { rows: number }).rows;
  const colorize = (text: string, color: number) => `\x1b[38;5;${color}m${text}\x1b[0m`;
  const dynamic = (tick: number): string => {
    const spinner = "|/-\\"[tick % 4];
    let out = "";
    for (let row = 4; row < rows; row += 1) {
      const body =
        row === 4
          ? `${spinner} Working (${tick}s)  esc to interrupt`
          : `${colorize("•", 70 + (row % 6))} step ${row} of ${rows}: reading files, analyzing λ 日本語 and writing output ${"=".repeat(20 + (row % 7))}`;
      out += `\x1b[${row + 1};1H\x1b[2K${body}`;
    }
    return out;
  };
  const content = (tick: number): string => {
    if (benchKind === "stream") {
      return `${colorize(`token ${tick}`, 33 + (tick % 8))} lorem ipsum dolor sit amet consectetur adipiscing elit ${tick} ${"x".repeat(tick % 40)}\r\n`;
    }
    if (benchKind === "rewrite") return dynamic(0);
    return dynamic(tick);
  };
  // The window canvas is not involved: panes draw into an offscreen target of their own size.
  const rect = (surface.diagnostics() as unknown as {
    viewport: { x: number; y: number; width: number; height: number };
  }).viewport;
  const target = resources.device.createTexture({
    size: [rect.x + rect.width, rect.y + rect.height],
    format: resources.format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const targetView = target.createView();
  const drawPane = (): GPUCommandBuffer => {
    const commands = resources.device.createCommandEncoder();
    const pass = commands.beginRenderPass({
      colorAttachments: [
        { view: targetView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pass.setViewport(rect.x, rect.y, rect.width, rect.height, 0, 1);
    pass.setScissorRect(rect.x, rect.y, rect.width, rect.height);
    surface.encode(pass, resources);
    pass.end();
    return commands.finish();
  };
  // performance.now() is coarsened to 0.1 ms, so time batches of ticks.
  const BATCH = 10;
  const tickTimes: number[] = [];
  let drawn = 0;
  for (let batch = 0; batch < (ticks + warmup) / BATCH; batch += 1) {
    const measured = batch * BATCH >= warmup;
    const t0 = performance.now();
    for (let index = 0; index < BATCH; index += 1) {
      const tick = batch * BATCH + index;
      write(content(tick));
      if (surface.prepareFrame(resources)) {
        resources.device.queue.submit([drawPane()]);
        if (measured) drawn += 1;
      }
    }
    const elapsed = performance.now() - t0;
    if (measured) tickTimes.push(elapsed / BATCH);
    await resources.device.queue.onSubmittedWorkDone();
  }
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((total, value) => total + value, 0);
    return {
      mean: +(sum / values.length).toFixed(4),
      p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(4),
      p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(4),
      max: +sorted[sorted.length - 1].toFixed(4),
    };
  };
  (window as unknown as { __bench: unknown }).__bench = {
    kind: benchKind,
    ticks,
    drawn,
    perTickMs: stats(tickTimes),
    cells: (surface.diagnostics() as unknown as { cols: number }).cols * rows,
    diagnostics: surface.diagnostics(),
  };
  document.title = "bench done";
}
