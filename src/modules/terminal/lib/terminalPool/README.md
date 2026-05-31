# terminalPool — persistent-buffer / pooled-GPU terminal renderer

## Model

**One persistent `@xterm/xterm` Terminal per leaf, for the leaf's whole
lifetime.** The emulator is created once (`ensureEmulator`), kept in a
`Map<leafId, Emulator>`, and is ALWAYS fed PTY bytes regardless of visibility.
A tab/pane switch is a pure **view** operation — attach/detach the leaf's host
element — never a state rebuild.

Only the scarce GPU resource (WebGL contexts) is pooled, capped at
`MAX_GL_CONTEXTS`. This is the VS Code / iTerm2 / Windows Terminal model.

## Why (the root cause it fixes)

The old `rendererPool` recycled whole Terminal objects across leaves (cap 5).
A 6th leaf evicted a backgrounded one, so a leaf could LOSE its emulator. To
survive that, Terax serialized the leaf to a snapshot (capped 5000 rows) + a
256KB byte ring and rebuilt it via `clear()+reset()+write(snapshot)+replay` on
every show. That lossy round-trip was the single origin of three defects:

- **A — blank on quick (<10s) switch-back:** the rebuild's forced repaint was
  gated on `SLOT_STALE_MS=10000`, so a fast re-show skipped it.
- **B — garble:** the 256KB `DormantRing` dropped MIDDLE bytes on overflow;
  replaying a gapped tail landed cursor-relative TUI redraws on wrong rows.
- **C — scroll-loss:** the 5000-row serialize cap + `clear()+reset()` discarded
  real scrollback.

Removing the precondition (never recycle the emulator) eliminates all three at
the root. There is no serialize, no ring, no clear-on-switch.

## Files

| File | Responsibility |
|------|----------------|
| `index.ts` | Slim barrel. Re-exports the public API `useTerminalSession` consumes; no logic. |
| `emulator.ts` | Per-leaf persistent emulator lifecycle. Owns `Map<leafId, Emulator>`, the offscreen recycler, the IME keymap handler + `onData`->PTY wiring (registered ONCE per emulator), GL grant/revoke, `dispose`. |
| `view.ts` | Tab-switch hot path. `attachView` (show: move host into container, fit, recompute GL) / `detachView` (hide: park host in recycler). Owns the ResizeObserver -> fit -> debounced PTY-resize chain. Never mutates the buffer. |
| `glContextPool.ts` | The ONLY pooled scarce resource. Pure `grantPolicy(leaves)` (cap-bounded, prioritizes visible+top) + WebGL attach/dispose/`releaseCanvasContext` + context-loss recovery (moved verbatim from `rendererPool`). |
| `writeScheduler.ts` | F3 background-write coalescer. Visible leaf = synchronous write; hidden leaf = per-frame coalesced write. Injectable clock. Never drops bytes. |
| `preferences.ts` | `apply*` setters fanning out over the emulator Map + the F2 single-tier scrollback (user pref for every leaf — no background shrink). |

## F1 — hidden leaves cannot be truly renderer-less (resolved by DOM-detach)

xterm 6 has no renderer-less mode for a full `Terminal`. The cheapest correct
hidden strategy is moving the host OUT of the visible tree into the offscreen
recycler (`emulator.getRecycler`). DOM-detach stops render at two layers while
the parser keeps the buffer current:

- **Layer 1 (renderer-agnostic):** xterm's `RenderService` IntersectionObserver
  reports `isIntersecting=false` -> `_isPaused=true` -> `refreshRows` early-
  returns -> no `requestAnimationFrame`.
- **Layer 2 (WebGL):** `WebglRenderer.renderRows` early-returns while
  `screenElement.isConnected===false`.

On show, re-attaching makes it intersect -> xterm's own
`_handleIntersectionChange` fires `refreshRows(0, rows-1)`, a full repaint from
the live buffer. This is the structural cure for Defect A and replaces the
deleted `SLOT_STALE_MS` manual refresh.

> Verified against the **installed** packages (not memory):
> `node_modules/@xterm/xterm/lib/xterm.js` — IntersectionObserver, `_isPaused`,
> `refreshRows`, `_handleIntersectionChange` all present;
> `node_modules/@xterm/addon-webgl/lib/addon-webgl.js` — `isConnected`,
> `setRenderer`, `_createRenderer` present (so a GL-revoked leaf falls back to
> the DOM renderer, never renderer-less). `@xterm/headless` is NOT installed.

## F2 — bounded memory (single scrollback = the user's pref, no background trim)

`preferences.ts` applies ONE scrollback to every leaf — foreground OR
background — equal to the user's `terminalScrollback` pref (default 2000, up to
50000). It is **never shrunk on hide.**

> **Why no background cap (the regression that was fixed):** an earlier
> two-tier design shrank a backgrounded leaf's `options.scrollback` to a 1000-
> line cap. But xterm trims an already-populated buffer **permanently and
> irreversibly** the instant `options.scrollback` drops below the buffer length
> (probe: scrollback 6000 with 5500 lines, set to 1000 → `buffer.length`
> 5501→1024, `getLine(0)` `'line0'`→`'line4477'`; re-growing back to 6000 does
> **not** restore the lost lines). So shrink-on-hide destroyed all history
> beyond 1000 lines on **every tab switch** — silently undermining the Defect C
> fix and violating the user's scrollback setting. VS Code, iTerm2 and Windows
> Terminal do **not** trim background scrollback either. Correctness (zero
> history loss) outweighs aggressive background memory reclaim, so the cap is
> gone. `applyScrollbackFor` now only ever **grows** a buffer (when the user
> raises the pref) and never shrinks a populated one on a visibility change.
> `TERMINAL_BG_SCROLLBACK_CAP` is retained only for the stable export surface
> and is no longer used to shrink.

**RAM budget** — RAM now scales with the user's chosen scrollback pref × tabs
(industry-normal, and **bounded by the pref the user explicitly set**, max
50000). Order-of-magnitude (~12 bytes/cell amortized, ~1.5× overhead, 120
cols): at the default 2000-row pref ≈ 4-6MB/tab → 10 tabs ≈ 40-60MB, 30 ≈
120-180MB; at a large 10000-row pref a tab is ≈ 20-30MB. These are
cells×bytes+overhead estimates, NOT measured — validate with a DevTools heap
snapshot in the running app before quoting as a hard budget. A user who wants a
smaller footprint lowers the scrollback pref; the platform never silently
discards the history they asked to keep.

## F3 — bounded background CPU + RAM (write coalescer)

Hidden leaves still parse PTY bytes (skipping parse is what caused Defect B), so
`writeScheduler` collapses a hidden `yes`/`tail -f` flood from thousands of tiny
`write()` calls into ~60 coalesced writes/sec. xterm's own WriteBuffer
(`WRITE_TIMEOUT_MS` slicing + `DISCARD_WATERMARK`) bounds the parse on top of
this. Visible leaves write synchronously — zero hot-path regression.

**Bounded under a paused rAF.** When the OS backgrounds the whole app window,
`requestAnimationFrame` is throttled/paused. A coalescer that flushed ONLY on
rAF would let the per-leaf `chunks[]` grow unbounded under a background flood
until the window is foregrounded. Two guards prevent that without dropping a
byte:
1. a per-leaf **pending-byte cap** (`MAX_PENDING_BYTES`, 256KB — the deleted
   DormantRing's old hard limit, minus its lossy middle-byte drop): crossing it
   flushes NOW into the persistent buffer (itself bounded by `scrollback`);
2. a **`setTimeout` fallback flush** (`FALLBACK_FLUSH_MS`) scheduled alongside
   the rAF request, draining the queue even when rAF never fires.

Both clocks are injectable (`RafClock` + `TimerClock`) so the paused-rAF path is
deterministically unit-tested. Locked by `viewIntegration.test.ts` (c).

## GL-context invariant (strict at every instant, including creation)

`grantPolicy` NEVER returns more than `MAX_GL_CONTEXTS` (~5) leafIds; visible +
top (focused) leaves are prioritized; over-cap / non-visible leaves use the DOM
renderer. Every revoke calls `releaseCanvasContext` (`WEBGL_lose_context`) to
stay under the browser's ~16-context ceiling.

**`ensureEmulator` does NOT grant GL.** An earlier version called `grantGl()`
unconditionally at emulator creation, so a multi-tab restore (which creates one
emulator per leaf before any is shown) could allocate up to *N* transient real
contexts BEFORE `recomputeGl` pruned back to the cap — eventually-consistent,
not strict, and able to spike toward WebKit's ~16 ceiling. `recomputeGl` /
`attachView` are now the **only** grant path, so the cap holds at the instant a
context is ever created. Locked by `glContextPool.test.ts` (pure policy) and
`viewIntegration.test.ts` (real creation + attach path, counting GL backend).

## Tests

- `bufferFidelity.test.ts` — real headless Terminal at the buffer level: no data
  loss across a (no-op) hide/show, full scrollback beyond the old 5000 cap,
  bounded trim. FAILS against the old `clear()+reset()`/serialize path. NOTE:
  this test simulates 'hide' as a buffer no-op; the REAL hide path
  (`detachView` + `applyScrollbackFor`) is exercised by `viewIntegration.test.ts`.
- `writeScheduler.test.ts` — foreground synchronous; hidden coalesced per frame;
  no byte loss on a >256KB multi-chunk flood (Defect B regression).
- `glContextPool.test.ts` — pure grant policy never exceeds cap, prioritizes
  visible+top.
- `viewIntegration.test.ts` — the REAL view/preferences/GL paths against real
  headless emulators (the gap the adversarial review flagged). Locks the three
  fixed regressions; each assertion FAILS against the pre-fix code:
  - **(a)** deep >1000-line history survives a real `detachView`+`applyScrollbackFor`
    (hide) → `attachView`+`applyScrollbackFor` (show) cycle — no trim (regression 1 / Defect C).
  - **(b)** a 12-tab restore + show + focus churn NEVER exceeds `MAX_GL_CONTEXTS`
    at any instant, including the creation path; creation grants zero (regression 2).
  - **(c)** a hidden-leaf flood with rAF 'paused' stays bounded (per-leaf byte
    cap) and still drains losslessly via the rAF-independent `setTimeout`
    fallback (regression 3).
