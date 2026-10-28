// The PTY checks shared by the old and new transports, so the same workload
// produces comparable numbers. Everything runs against a real login shell in
// the real webview; counts are of requests the page actually made.
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type OpenPty = (
  cols: number,
  rows: number,
  handlers: {
    onData: (bytes: Uint8Array) => void | Promise<void>;
    onExit?: (code: number) => void;
  },
  cwd?: string,
  blocks?: boolean,
  shell?: string,
  paneId?: number,
) => Promise<{
  id: number;
  write: (data: string | Uint8Array) => Promise<void>;
  close: () => Promise<void>;
}>;

export type Driver = {
  name: string;
  openPty: OpenPty;
  setPresentation?: (leaf: number, visible: boolean, focused: boolean) => void;
  /** IPC operations so far, given the chunks delivered through channels. */
  streamOps: (deliveries: number) => number;
  breakdown: () => Record<string, number>;
  native: () => Promise<{
    hub?: Record<string, number>;
    sessions: unknown[];
  }>;
  jsHub: () => unknown;
  /** Admission checks of the stream scheme; the multiplexed transport only. */
  probeGate?: () => Promise<Record<string, unknown>>;
  realFetch: typeof fetch;
};

declare const __SMOKE_BASE_URL__: string;
declare const __SMOKE_IDLE_MS__: number;
declare const __SMOKE_SPIN_SECONDS__: number;
declare const __SMOKE_FAST__: boolean;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(
  condition: () => boolean,
  timeoutMs: number,
  label: string,
) {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline)
      throw new Error(`timed out waiting for ${label}`);
    await sleep(2);
  }
}

type Terminal = Awaited<ReturnType<typeof terminal>>;

async function terminal(driver: Driver, leaf: number) {
  const decoder = new TextDecoder();
  let tail = "";
  let bytes = 0;
  let zeros = 0;
  let deliveries = 0;
  let exit: number | null = null;
  let first: number | null = null;
  const session = await driver.openPty(
    100,
    30,
    {
      onData: (chunk) => {
        first ??= performance.now();
        deliveries++;
        bytes += chunk.length;
        // The exactness check scans every byte; --fast skips it so transport
        // throughput is not bounded by this harness's own parse cost.
        if (!__SMOKE_FAST__)
          for (let index = 0; index < chunk.length; index++)
            if (chunk[index] === 0) zeros++;
        // Keep a short tail: floods would otherwise retain megabytes.
        tail = (tail + decoder.decode(chunk, { stream: true })).slice(-4096);
      },
      onExit: (code) => {
        exit = code;
      },
    },
    undefined,
    false,
    undefined,
    leaf,
  );
  return {
    session,
    text: () => tail,
    bytes: () => bytes,
    zeros: () => zeros,
    deliveries: () => deliveries,
    exit: () => exit,
    firstOutputAt: () => first,
  };
}

function percentiles(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    n: sorted.length,
    p50: Number(at(0.5).toFixed(1)),
    p95: Number(at(0.95).toFixed(1)),
    max: Number(sorted[sorted.length - 1].toFixed(1)),
  };
}

async function spinners(driver: Driver, scenario: "allFocused" | "oneFocusedNineHidden") {
  const seconds = __SMOKE_SPIN_SECONDS__;
  const spin = `i=0; while [ $i -lt ${seconds * 20} ]; do printf '\\rframe %d ' $i; i=$((i+1)); sleep 0.05; done; echo spin-$((1+1))-done\n`;
  const terminals: Terminal[] = [];
  for (let leaf = 101; leaf <= 110; leaf++) {
    const focused = scenario === "allFocused" || leaf === 101;
    driver.setPresentation?.(leaf, focused, focused);
    terminals.push(await terminal(driver, leaf));
  }
  await Promise.all(terminals.map((t) => until(() => t.bytes() > 0, 20_000, "spinner shell")));
  await sleep(1500); // let every prompt finish drawing
  const opsBefore = driver.streamOps(terminals.reduce((n, t) => n + t.deliveries(), 0));
  const deliveriesBefore = terminals.map((t) => t.deliveries());
  const breakdownBefore = driver.breakdown();
  const bytesBefore = terminals.map((t) => t.bytes());
  const t0 = performance.now();
  await Promise.all(terminals.map((t) => t.session.write(spin)));
  await Promise.all(
    terminals.map((t) =>
      until(() => t.text().includes("spin-2-done"), (seconds + 30) * 1000, "spinner done"),
    ),
  );
  const elapsed = (performance.now() - t0) / 1000;
  const deliveries = terminals.reduce((n, t, i) => n + t.deliveries() - deliveriesBefore[i], 0);
  const ops = driver.streamOps(terminals.reduce((n, t) => n + t.deliveries(), 0)) - opsBefore;
  const breakdownAfter = driver.breakdown();
  const result = {
    seconds: Number(elapsed.toFixed(2)),
    ipcOpsPerSecond: Number((ops / elapsed).toFixed(1)),
    ipcOps: ops,
    chunksDelivered: deliveries,
    deliveredBytes: terminals.reduce((n, t, i) => n + t.bytes() - bytesBefore[i], 0),
    breakdown: Object.fromEntries(
      Object.entries(breakdownAfter).map(([key, value]) => [key, value - (breakdownBefore[key] ?? 0)]),
    ),
    complete: terminals.every((t) => t.text().includes("spin-2-done")),
  };
  for (const t of terminals) await t.session.close();
  await sleep(300);
  return result;
}

declare const __SMOKE_ONLY__: string;
const only = (name: string) => __SMOKE_ONLY__ === "" || __SMOKE_ONLY__.split(",").includes(name);

export async function run(driver: Driver, resumed: Record<string, unknown> | null) {
  if (resumed) return finishAfterReload(driver, resumed);
  const out: Record<string, unknown> = { transport: driver.name };
  const started = performance.now();
  // A window that is covered or in the background is throttled on purpose
  // (250 ms delivery, 1 s timers); bring it forward so numbers mean latency.
  await getCurrentWindow().setFocus().catch(() => {});
  await sleep(500);
  driver.setPresentation?.(1, true, true);

  // 1. A shell echoes; exit codes arrive after all output.
  const one = await terminal(driver, 1);
  await until(() => one.bytes() > 0, 20_000, "first shell output");
  out.firstOutputMs = Math.round((one.firstOutputAt() ?? 0) - started);
  await sleep(1500);
  await one.session.write("printf 'smoke-%s\\n' ok$((6*7))\n");
  await until(() => one.text().includes("smoke-ok42"), 15_000, "echoed output");
  out.echo = true;
  await one.session.write("echo before-$((1+1))-exit; exit 3\n");
  await until(() => one.exit() !== null, 15_000, "exit code");
  out.exitCode = one.exit();
  out.exitAfterOutput = one.text().includes("before-2-exit");
  await one.session.close();

  // 2. Round-trip latency without a shell in the way: `cat` behind the tty's
  // own echo isolates write -> pty -> reader -> hub -> poll -> parse.
  if (only("latency")) {
    driver.setPresentation?.(3, true, true);
    const cat = await terminal(driver, 3);
    await until(() => cat.bytes() > 0, 20_000, "latency shell");
    await sleep(1500);
    await cat.session.write("exec cat\n");
    await sleep(800);
    const samples: number[] = [];
    let throttled = 0;
    for (let index = 0; index < 60; index++) {
      const before = cat.bytes();
      const sent = performance.now();
      const visible = document.visibilityState === "visible";
      await cat.session.write(".");
      await until(() => cat.bytes() > before, 5_000, "echo byte");
      if (visible && document.visibilityState === "visible")
        samples.push(performance.now() - sent);
      else throttled++;
      await sleep(20 + (index % 7) * 13);
    }
    out.keystrokeEchoMs = { ...percentiles(samples), skippedWhileHidden: throttled };
    await cat.session.close();
  }

  // 3. Ten spinning agents at 20 Hz.
  if (only("spinners")) {
    out.allFocused = await spinners(driver, "allFocused");
    if (driver.setPresentation)
      out.oneFocusedNineHidden = await spinners(driver, "oneFocusedNineHidden");
  }

  // 4. A 16 MiB flood of NUL bytes arrives exactly.
  const probing = only("flood") || (only("idle") && __SMOKE_IDLE_MS__ > 0);
  driver.setPresentation?.(2, true, true);
  const flood = probing ? await terminal(driver, 2) : null;
  if (flood) {
    await until(() => flood.bytes() > 0, 20_000, "flood shell");
    await sleep(1500);
  }
  if (flood && only("flood")) {
    const runs: Record<string, unknown>[] = [];
    for (let repeat = 0; repeat < 6; repeat++) {
      const zerosBefore = flood.zeros();
      const bytesBefore = flood.bytes();
      const opsBefore = driver.streamOps(flood.deliveries());
      const breakdownBefore = driver.breakdown();
      const chunksBefore = flood.deliveries();
      const f0 = performance.now();
      await flood.session.write(
        `head -c 16777216 /dev/zero; echo flood-${repeat}-$((2+3))-end\n`,
      );
      await until(
        () => flood.text().includes(`flood-${repeat}-5-end`),
        180_000,
        "flood end",
      );
      const seconds = (performance.now() - f0) / 1000;
      const received = __SMOKE_FAST__
        ? flood.bytes() - bytesBefore - 140 // the echoed command and marker
        : flood.zeros() - zerosBefore;
      const breakdownAfter = driver.breakdown();
      runs.push({
        ipcOps: driver.streamOps(flood.deliveries()) - opsBefore,
        chunksDelivered: flood.deliveries() - chunksBefore,
        breakdown: Object.fromEntries(
          Object.entries(breakdownAfter).map(([key, value]) => [
            key,
            value - (breakdownBefore[key] ?? 0),
          ]),
        ),
        exact: __SMOKE_FAST__
          ? Math.abs(received - 16 * 1024 * 1024) < 400
          : received === 16 * 1024 * 1024,
        megabytesPerSecond: Number((received / 1048576 / seconds).toFixed(1)),
        seconds: Number(seconds.toFixed(2)),
      });
      await sleep(300);
    }
    out.flood = runs;
  }

  // 5. An idle stream stays healthy across keepalives and still delivers.
  if (flood && only("idle") && __SMOKE_IDLE_MS__ > 0) {
    await sleep(__SMOKE_IDLE_MS__);
    const probeAt = performance.now();
    await flood.session.write("echo idle-$((4+4))-ok\n");
    await until(() => flood.text().includes("idle-8-ok"), 15_000, "post-idle output");
    out.idle = {
      idleMs: __SMOKE_IDLE_MS__,
      resumedMs: Math.round(performance.now() - probeAt),
      keepalives: (await driver.native()).hub?.keepalives ?? null,
    };
  }
  await flood?.session.close();
  await sleep(500);
  const end = await driver.native();
  out.sessionsLeftOpen = end.sessions.length;
  out.hub = end.hub ?? null;
  out.js = driver.jsHub();

  // 6. Reload with a live terminal: the held request and stream die with the
  // page, the new page reaps the orphan and streams again.
  const orphan = await terminal(driver, 9);
  await until(() => orphan.bytes() > 0, 20_000, "orphan shell");
  // 7. Requests the scheme must refuse without waking the hub. Last, because
  // it reopens the stream and so ends this page's own.
  if (driver.probeGate) out.gate = await driver.probeGate();
  out.totalSeconds = Number(((performance.now() - started) / 1000).toFixed(1));
  sessionStorage.setItem("pty-smoke", JSON.stringify(out));
  location.reload();
  return await new Promise<never>(() => {});
}

async function finishAfterReload(driver: Driver, before: Record<string, unknown>) {
  const out = { ...before };
  driver.setPresentation?.(11, true, true);
  const reaped = await invoke<number>("pty_close_all");
  const fresh = await terminal(driver, 11);
  await until(() => fresh.bytes() > 0, 20_000, "post-reload shell");
  await sleep(1500);
  await fresh.session.write("printf 'reload-%s\\n' ok$((9*9))\n");
  await until(() => fresh.text().includes("reload-ok81"), 15_000, "post-reload echo");
  out.reload = { orphansReaped: reaped, echoAfterReload: true };
  await fresh.session.close();
  await sleep(300);
  out.sessionsAtEnd = (await driver.native()).sessions.length;
  return out;
}

export async function finish(driver: Driver, payload: unknown) {
  document.querySelector("#result")!.textContent = JSON.stringify(payload, null, 2);
  await sleep(200);
  await driver.realFetch(`${__SMOKE_BASE_URL__}/report`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await getCurrentWindow().close();
}
