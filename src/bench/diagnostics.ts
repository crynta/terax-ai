import { terminalDebugStats } from "@/modules/terminal/lib/terminalDiagnostics";
import type { Tab } from "@/modules/tabs";
import { drainEventLog, listenerCensus } from "./eventLog";
import { gpuCounters } from "./gpuCounters";

/** Layout of the open tabs, so a report says which tab each sample was taken on. */
function tabSummary(tabs: Tab[], activeId: number) {
  return tabs.map((tab) => ({
    id: tab.id,
    kind: tab.kind,
    active: tab.id === activeId,
    cold: "cold" in tab ? Boolean(tab.cold) : false,
    leaves: tab.kind === "terminal" ? countLeaves(tab.paneTree) : 0,
  }));
}

function countLeaves(node: { kind: string; children?: unknown[] }): number {
  if (node.kind === "leaf") return 1;
  return (node.children ?? []).reduce<number>(
    (sum, child) => sum + countLeaves(child as typeof node),
    0,
  );
}

/**
 * In-app counters for one sample: the terminal diagnostics (WASM memory per instance, canvas pool,
 * GPU buffer sizes, sessions, presentation) plus DOM size. `performance.memory` does not exist in
 * WebKit, so the JS heap cannot be read from the page; the orchestrator attributes WebKit malloc
 * with footprint/vmmap instead.
 */
export function collectDiagnostics(tabs: Tab[], activeId: number) {
  const stats = terminalDebugStats();
  return {
    ...stats,
    dom: {
      elements: document.getElementsByTagName("*").length,
      canvases: document.querySelectorAll("canvas").length,
      canvasPixels: [...document.querySelectorAll("canvas")].reduce(
        (sum, canvas) => sum + canvas.width * canvas.height,
        0,
      ),
      attachedCanvases: [...document.querySelectorAll("canvas")].filter(
        (canvas) => canvas.isConnected,
      ).length,
    },
    tabs: tabSummary(tabs, activeId),
    counters: gpuCounters.instrumented ? { ...gpuCounters } : null,
    page: gpuCounters.instrumented ? pageCensus() : null,
    // Running CSS/Web animations keep the compositor committing frames while the window is idle.
    animations: document.getAnimations?.().length ?? null,
    devicePixelRatio: window.devicePixelRatio,
    innerSize: [window.innerWidth, window.innerHeight],
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
  };
}

/**
 * What the page holds besides the terminals, for leak hunting: DOM nodes by kind, explorer rows,
 * listeners left on long-lived targets, resource-timing entries, and the page events since the
 * previous sample (see eventLog.ts).
 */
function pageCensus() {
  const log = drainEventLog();
  return {
    nodes: countNodes(),
    explorerRows: document.querySelectorAll("[data-fs-path]").length,
    listeners: listenerCensus(),
    resourceEntries: performance.getEntriesByType("resource").length,
    events: log.events,
    eventsDropped: log.dropped,
  };
}

function countNodes(): number {
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
  let count = 0;
  while (walker.nextNode()) count++;
  return count;
}
