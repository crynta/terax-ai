/**
 * Optional WebGPU/DOM lifecycle counters for the app lab (`scenario.instrument`). They patch
 * prototypes, so they are off unless asked for; a run with and without them tells whether the
 * instrumentation changes what is measured. Counts calls and, through FinalizationRegistry, how
 * many wrapper objects the JS garbage collector has released: objects created minus finalized
 * is what JavaScript still holds (and, with it, what WebKit keeps for them in the WebContent
 * process).
 */
import { logIpc } from "./eventLog";

type Counters = Record<string, number>;

export const gpuCounters: Counters = { instrumented: 0 };

const bump = (name: string, by = 1) => {
  gpuCounters[name] = (gpuCounters[name] ?? 0) + by;
};

type Constructor = { prototype: Record<string, unknown> } | undefined;

/** ES2021; the project compiles against ES2020 libs. */
type Registry = { register(target: object, held: string): void };
type RegistryConstructor = new (finalized: (held: string) => void) => Registry;
const FinalizationRegistryCtor = (
  globalThis as unknown as { FinalizationRegistry?: RegistryConstructor }
).FinalizationRegistry;

export function installGpuCounters(): void {
  if (gpuCounters.instrumented || !FinalizationRegistryCtor) return;
  gpuCounters.instrumented = 1;
  try {
    install();
  } catch (error) {
    console.error("[bench] counters partially installed:", error);
  }
}

function install(): void {
  if (!FinalizationRegistryCtor) return;
  const Registry = FinalizationRegistryCtor;
  const registries = new Map<string, Registry>();
  const track = (kind: string, object: object) => {
    let registry = registries.get(kind);
    if (!registry) {
      registry = new Registry((name) => bump(`${name}.finalized`));
      registries.set(kind, registry);
    }
    bump(`${kind}.created`);
    registry.register(object, kind);
  };
  const g = globalThis as unknown as Record<string, Constructor>;
  const wrap = (
    owner: Constructor,
    name: string,
    after: (result: unknown, args: unknown[]) => void,
  ) => {
    const prototype = owner?.prototype;
    const original = prototype?.[name] as
      | ((...args: unknown[]) => unknown)
      | undefined;
    if (!prototype || !original) return;
    prototype[name] = function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      after(result, args);
      return result;
    };
  };
  for (const [method, kind] of [
    ["createBuffer", "gpuBuffer"],
    ["createTexture", "gpuTexture"],
    ["createBindGroup", "gpuBindGroup"],
    ["createBindGroupLayout", "gpuBindGroupLayout"],
    ["createShaderModule", "gpuShaderModule"],
    ["createRenderPipeline", "gpuRenderPipeline"],
    ["createCommandEncoder", "gpuCommandEncoder"],
    ["createSampler", "gpuSampler"],
  ] as const) {
    wrap(
      g.GPUDevice,
      method,
      (result) => result && track(kind, result as object),
    );
  }
  wrap(
    g.GPUTexture,
    "createView",
    (result) => result && track("gpuTextureView", result as object),
  );
  wrap(g.GPUBuffer, "destroy", () => bump("gpuBuffer.destroy"));
  wrap(g.GPUTexture, "destroy", () => bump("gpuTexture.destroy"));
  wrap(g.GPUQueue, "writeBuffer", () => bump("queue.writeBuffer"));
  wrap(g.GPUQueue, "writeTexture", () => bump("queue.writeTexture"));
  wrap(g.GPUQueue, "submit", () => bump("queue.submit"));
  wrap(g.GPUCanvasContext, "configure", () => bump("canvas.configure"));
  wrap(g.GPUCanvasContext, "unconfigure", () => bump("canvas.unconfigure"));
  wrap(g.GPUCanvasContext, "getCurrentTexture", (result) => {
    bump("canvas.getCurrentTexture");
    if (result) track("canvasTexture", result as object);
  });
  const seen = new WeakSet<object>();
  wrap(g.HTMLCanvasElement, "getContext", (result, args) => {
    if (result && args[0] === "webgpu" && !seen.has(result as object)) {
      seen.add(result as object);
      track("canvasContext", result as object);
    }
  });
  const createElement = document.createElement.bind(document);
  document.createElement = ((tag: string, options?: ElementCreationOptions) => {
    const element = createElement(tag, options);
    if (tag.toLowerCase() === "canvas") track("canvasElement", element);
    return element;
  }) as typeof document.createElement;
  // Re-parenting: how often an element is moved between parents.
  for (const method of [
    "appendChild",
    "insertBefore",
    "removeChild",
    "replaceChild",
  ]) {
    wrap(g.Node, method, (result) => {
      if (result instanceof HTMLCanvasElement) bump(`dom.canvas.${method}`);
    });
  }
  wrap(g.Element, "remove", () => bump("dom.remove"));
  countIpc();
  countTimers();
}

/**
 * Tauri IPC by command (and payload size): what the application asks the host for per switch.
 * `__TAURI_INTERNALS__` is not writable, so the custom-protocol requests are counted at `fetch`.
 */
function countIpc(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith("ipc://") || url.includes("ipc.localhost")) {
      const command = decodeURIComponent(
        url.split("?")[0].split("/").pop() ?? "?",
      );
      bump(`ipc.${command}`);
      logIpc(command);
      const body = init?.body;
      if (typeof body === "string") bump("ipc.bytes", body.length);
      else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body))
        bump("ipc.bytes", body.byteLength);
    } else if (url.includes("terax-pty")) {
      bump(url.endsWith("/poll") ? "pty.poll" : "pty.ack");
    }
    return realFetch(input, init);
  }) as typeof window.fetch;
}

/**
 * Page wakeups: timers by delay and animation-frame callbacks. An idle window with a steady
 * stream of these (or a running CSS animation) keeps the compositor and the host process awake.
 */
function countTimers(): void {
  const bucket = (delay: unknown) => {
    const ms = Number(delay) || 0;
    if (ms < 20) return "<20ms";
    if (ms < 100) return "<100ms";
    if (ms < 1000) return "<1s";
    return ">=1s";
  };
  const timeout = window.setTimeout.bind(window);
  window.setTimeout = ((
    handler: TimerHandler,
    delay?: number,
    ...args: unknown[]
  ) => {
    bump(`timer.setTimeout.${bucket(delay)}`);
    return timeout(handler, delay, ...args);
  }) as typeof window.setTimeout;
  const interval = window.setInterval.bind(window);
  window.setInterval = ((
    handler: TimerHandler,
    delay?: number,
    ...args: unknown[]
  ) => {
    bump(`timer.setInterval.${Number(delay) || 0}ms.created`);
    const wrapped =
      typeof handler === "function"
        ? (...rest: unknown[]) => {
            bump(`timer.setInterval.${Number(delay) || 0}ms.fired`);
            return (handler as (...a: unknown[]) => unknown)(...rest);
          }
        : handler;
    return interval(wrapped, delay, ...args);
  }) as typeof window.setInterval;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    bump("timer.requestAnimationFrame");
    return raf(callback);
  }) as typeof window.requestAnimationFrame;
}
