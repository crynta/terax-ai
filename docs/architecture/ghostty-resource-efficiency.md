# Resource efficiency

Current resource architecture, its invariants, and how to measure it. `TERAX.md`
takes precedence; the renderer details are in
[renderer v2](terminal-renderer-v2.md), the transport in
[PTY transport v2](pty-transport-v2.md).

## Ownership and budgets

| Area | What it costs and when it is released |
| --- | --- |
| Terminal model | One WASM instance per terminal, from one compiled module; closing a terminal drops its linear memory. Blank instance 320 KiB (96 KiB stack), blank 120x40 terminal ~1.1 MiB. Scrollback across terminals is capped at 192 MiB without pruning history already held. |
| PTY transport | One held `terax-pty` poll per window carries every terminal's output; acks ride the next poll. Hidden terminals coalesce at 100 ms, an occluded window at 250 ms. 10 spinners at 20 Hz: ~55 IPC operations/s (was ~345). |
| Renderer | One WebGPU canvas per window terminal area, never destroyed or resized by tab switches or splits; cell buffers are uploaded straight from WASM memory, only changed rows. Per-frame WebGPU wrappers are mirrored to the garbage collector (`gpu/GcPressure.ts`). |
| Resizing | One synchronized model + PTY resize per gesture; at most one canvas growth and one compaction per drag. |
| Idle | No timers or frames while nothing changes; the focused input never shows a native caret (it keeps the display link running). Focused idle terminal: 0.24 % CPU, ~11 wakeups/s. |
| Hidden / occluded | Hidden panes leave the canvas and release cell buffers; occlusion and sleep pause without releasing (WebKit leaks destroyed swapchains). CSS animations pause while the window is inactive. |
| App shell | No AI SDK, zod, CodeMirror, Streamdown or icon set in either window's startup graph (`dist-budget.test.ts`); a collapsed explorer holds no watchers; `git status` runs only for visible consumers; compositing budget enforced by `compositingBudget.test.ts`. |
| Backend | Heavy fs/history/shell/git commands run on the blocking pool (never the macOS main thread); one directory-level FSEvents stream per root; two async workers; pooled HTTP/2 AI clients with byte credit; conversation saves coalesced and fsync'd only at durable points. |

## Measuring

- `pnpm profile:app` (`scripts/app-lab`, [app lab](app-lab.md)): the real app in an
  isolated profile with real PTYs. Scenarios: `tabs`, `resize`, `split-drag`,
  `occlusion`, `agents-steady`, `idle`, `fs-churn`, `input`. Per-process footprint
  categories, rusage CPU/energy/wakeups, in-app counters.
- `pnpm profile:renderer:*` (`scripts/renderer-profile`): the renderer alone in a
  native WKWebView, incl. raw-WebGPU canvas probes.
- `pnpm profile:ghostty`, `pnpm soak:ghostty`, `node scripts/ghostty-webkit-memory.mjs`:
  WASM core allocation, stack depth, and memory return per instance.
- `scripts/pty-smoke`: the real transport inside the real webview (latency, floods,
  reload, admission checks).
- `scripts/terminal-visual`: pixel readback of a fixed pattern through any tree.
- Release diagnostics: `localStorage.setItem("terax:terminal-diagnostics", "1")`,
  reload, then `window.__teraxTerm()` / `await window.__teraxTermSnapshot()`.

Reports go to a directory outside the repository. Compare medians of repeats; for
memory prefer the timeline floor and the value after a forced collection, because
WebKit releases dead native objects only when JavaScriptCore collects.

## Known limits

- WebKit-intrinsic costs: a live window drag allocates a viewport-sized page tile
  per step (an empty page peaks at ~420 MiB, released after the drag).
- JavaScriptCore gives fast (signal-handled) memory to at most eight WASM instances;
  terminals beyond the eighth parse about 1.8x slower (still millions of lines/s).
- Measured on macOS (M4) only; Windows (WebView2) and Linux (WebKitGTK) need real
  hardware runs.
