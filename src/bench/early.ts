import { invoke } from "@tauri-apps/api/core";
import { BENCH_FLAG_PREFIX } from "./flags";
import { installEventLog } from "./eventLog";
import { installGpuCounters } from "./gpuCounters";
import { installSmoothProbe } from "./smoothProbe";
import type { BenchConfig } from "./types";

/**
 * Runs before the application renders (main.tsx): applies the scenario's localStorage entries
 * so every experiment toggle is in force when the terminal modules first read it, and clears
 * stale `terax:bench:*` entries left by an earlier run that shared this webview's storage.
 */
export async function installBenchEarly(): Promise<BenchConfig | null> {
  let config: BenchConfig | null = null;
  try {
    config = await invoke<BenchConfig>("bench_config");
  } catch (error) {
    console.error("[bench] bench_config failed:", error);
    return null;
  }
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(BENCH_FLAG_PREFIX))
        window.localStorage.removeItem(key);
    }
    if (config.scenario) {
      window.localStorage.setItem("terax:terminal-diagnostics", "1");
      for (const [key, value] of Object.entries(
        config.scenario.localStorage ?? {},
      )) {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      }
    }
  } catch (error) {
    console.error("[bench] localStorage unavailable:", error);
  }
  injectExperimentCss();
  if (config.reportUrl) forwardPageErrors(config.reportUrl);
  if (config.scenario?.instrument) {
    installGpuCounters();
    installEventLog();
  }
  if (config.scenario) installSmoothProbe();
  (
    window as unknown as { __teraxBenchConfig?: BenchConfig }
  ).__teraxBenchConfig = config;
  return config;
}

/**
 * `--toggle css=<rules>` appends a stylesheet before the first paint, so a compositing
 * experiment (`will-change`, `contain`, a different clip) needs no rebuild.
 */
function injectExperimentCss(): void {
  try {
    const css = window.localStorage.getItem(`${BENCH_FLAG_PREFIX}css`);
    if (!css) return;
    const style = document.createElement("style");
    style.dataset.benchExperiment = "";
    style.textContent = css;
    document.head.append(style);
  } catch {
    // Storage or head unavailable: run the scenario unmodified.
  }
}

/** Uncaught errors and console.error reach the orchestrator, so a dead page is not a silent hang. */
function forwardPageErrors(reportUrl: string): void {
  const send = (message: string) => {
    void fetch(`${reportUrl}/log`, { method: "POST", body: message }).catch(
      () => undefined,
    );
  };
  window.addEventListener("error", (event) =>
    send(`error: ${event.message} @${event.filename}:${event.lineno}`),
  );
  window.addEventListener("unhandledrejection", (event) =>
    send(`unhandledrejection: ${String(event.reason)}`),
  );
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    send(`console.error: ${args.map(String).join(" ")}`);
    original(...args);
  };
}
