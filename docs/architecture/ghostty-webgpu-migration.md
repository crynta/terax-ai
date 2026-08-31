# Ghostty terminal migration

This document defines the migration from xterm.js with WebGL to libghostty-vt
with Terax-owned WebGPU and WebGL renderers. Ghostty WebGPU is the branch
default on webviews that expose WebGPU. Ghostty WebGL is the first capability
and live-runtime fallback, followed by xterm WebGL when neither Ghostty GPU
surface can run. Release selection remains gated by the acceptance matrix
below.

## Goals

- Preserve Terax shell, PTY, tab, pane, block, AI, clipboard, link, search, IME, and accessibility behavior.
- Render only in response to damage, resize, cursor state, selection, or visibility changes.
- Keep terminal state correct while a tab is hidden without retaining an unbounded number of GPU contexts.
- Share expensive GPU resources within one window.
- Bound scrollback, glyph caches, pending PTY bytes, staging buffers, and renderer count.
- Measure release builds with identical Terax workloads before selecting a default backend.

## Non-goals for the first vertical slice

- Removing xterm dependencies.
- Replacing the Rust PTY or shell integration.
- Changing the tab, pane, block, or AI product model.
- Claiming a performance improvement from the isolated prototype.

## Ownership model

The current xterm pool couples four responsibilities in each slot: VT parsing, scrollback, DOM input, and GPU rendering. The new backend separates them.

### Per terminal leaf

Each live leaf owns an `AdaptedGhosttyTerminalModel` backed by libghostty-vt. It receives every PTY byte, including while hidden. It owns:

- parser and terminal modes;
- normal and alternate screens;
- bounded scrollback;
- cursor state and logical selection text extraction;
- terminal-generated replies;
- dirty-row metadata.

The surface-owned selection controller handles pointer capture and auto-scroll,
then commits both endpoints into Ghostty tracked pins in the model's global
scrollback coordinate space. Streaming output preserves the selection, and
scrollback eviction either clamps or clears endpoints according to native pin
validity. Text extraction is performed by the WASM model rather than by a stale
JavaScript viewport copy.

This removes snapshot replay and dormant-byte reconstruction from the Ghostty path. Closing a leaf frees its model.

### Per visible surface

A visible leaf may attach a lightweight `WebGpuTerminalSurface`. It owns only canvas-specific state:

- `GPUCanvasContext`;
- one 64-byte screen uniform;
- retained row instance ranges;
- packed cell and glyph instance buffers;
- resize observer and input element.

Hiding a leaf detaches or parks its surface. The model continues parsing without rendering.

The WebGL variant leases an xterm-inspired renderer from Terax's window pool.
It retains only one typed CPU glyph grid and the GPU buffer for that visible
surface. Dirty Ghostty row ranges become matching `bufferSubData` uploads.
Hidden leaves release the context immediately.

### Per Tauri window

One `WebGpuTerminalRuntime` is shared by all WebGPU surfaces in the window. It owns:

- one low-power `GPUAdapter` and `GPUDevice`;
- render pipelines, bind-group layouts, and samplers;
- a bounded glyph-atlas family keyed by font, weight, style, and scale;
- submission-tracked glyph upload staging;
- one frame scheduler for all dirty surfaces;
- device-loss recovery.

The runtime records every dirty surface into one command encoder and submits at
most one batch per animation frame. Cell and glyph attributes share one packed
GPU buffer, so each dirty row range requires one queue upload and both render
passes bind the same allocation. It performs no continuous idle rendering.
Pipelines are created asynchronously so shader and layout validation failures
are reported during startup rather than on the first interactive frame.
An asynchronous validation error quarantines the device for the rest of the
window lifetime. Live and subsequently restored surfaces preserve their model,
PTY, and scrollback while moving to WebGL.

One `WebGlTerminalRuntime` owns the bounded WebGL renderer pool and a single
frame scheduler. The pool allows at most five visible contexts, retains one
warm idle renderer, and reaps surplus idle contexts after 30 seconds.

## Backend boundary

Product code must depend on Terax contracts instead of xterm classes.

```ts
export interface TerminalModel {
  readonly backend: "ghostty-webgl" | "ghostty-webgpu";
  readonly cols: number;
  readonly rows: number;
  write(bytes: Uint8Array): void;
  resize(cols: number, rows: number): void;
  consumeDamage(): TerminalDamage;
  viewport(): PackedTerminalViewport;
  cursor(): TerminalCursor;
  modes(): TerminalModes;
  readText(maxLines: number): string;
  subscribeDamage(listener: () => void): () => void;
  diagnostics(): TerminalModelDiagnostics;
  dispose(): void;
}

export interface TerminalSurface {
  attach(container: HTMLElement): void;
  detach(): void;
  focus(): void;
  setFocused(focused: boolean): void;
  setVisible(visible: boolean): void;
  getSelection(): string | null;
  paste(text: string): void;
  dispose(): void;
}
```

Search, OSC events, markers, decorations, and viewport access use dedicated contracts. They are not added to one broad compatibility object.

The Ghostty session already uses Terax's raw `Uint8Array` PTY channels in both
directions. It does not serialize terminal output through JSON or reconstruct
hidden terminals from snapshots.

## Required libghostty-vt ABI work

The upstream bridge is a useful base, but its JavaScript API is not sufficient
for Terax. The maintained fork currently has the following status.

| ABI capability | Status |
| --- | --- |
| Direct typed active viewport and WASM row-hash damage | Implemented and tested |
| Scrollback viewport and wrapped-line metadata | Implemented and tested |
| Native DA1, DA2, DSR 5, and DSR 6 replies | Implemented and tested |
| Cursor style and blink read/write | Implemented and tested |
| Mouse, bracketed-paste, focus, and alternate-screen modes | Implemented |
| Kitty keyboard encoding and live mode state | Implemented and tested |
| Synchronized-output state, suppression, and watchdog | Implemented and tested |
| Explicitly zeroed reusable WASM terminal pages | Implemented and tested |
| Idempotent terminal and encoder disposal | Implemented and tested |
| Bounded OSC 7, OSC 52, OSC 133, title, bell, and notification event queue | Implemented and tested |
| Allocation and linear-memory diagnostics | Implemented and gated |
| XTGETTCAP, DECRQSS, DECRQM, XTWINOPS, and color queries | Implemented and tested |

The explicit WASM page zeroing is correctness-critical. Ghostty's native page
allocator receives zero-filled anonymous mappings, while a freestanding WASM
allocator can return reused dirty pages. Failing to restore that invariant
caused stale codepoints in blank cells and unnecessary glyph-atlas churn.

The Rust startup DA filter remains as a pre-frontend safety net for shells that
block before a model is ready. The runtime capability probe disables the
TypeScript DA fallback when the pinned core answers DA1 and DA2 natively.
Runtime replies otherwise belong to libghostty-vt.

## Input path

- Ghostty key encoding returns `Uint8Array` and stays binary through `InvokeBody::Raw`.
- Printable input, IME commits, paste, mouse reports, and terminal replies share the same bounded PTY write queue.
- The existing macOS CJK compensation remains until native-composition tests prove it is unnecessary.
- Custom Terax key bindings run before terminal encoding.
- Bracketed paste, focus reporting, mouse modes, and Kitty keyboard state come from the model's current modes.

## Rendering path

1. PTY bytes enter the model and are parsed immediately.
2. The model produces replies and ordered semantic events immediately, while
   coalescing render-state synchronization across all chunks before a frame.
3. The window scheduler marks the attached surface dirty once.
4. On the next frame, the model computes dirty-row ranges once and only changed
   rows update retained GPU ranges.
5. Cursor blink updates the shared screen uniform without rebuilding cell or
   glyph instances.
6. Hidden surfaces do not request frames.
7. Synchronized output defers presentation until mode 2026 is reset. A
   one-second watchdog presents a recovery frame if an application leaves the
   mode stuck.
8. Text blink schedules work only when a visible viewport contains blinking
   cells. Hidden panes and hidden webviews have no blink timer.

The WebGPU surface stores one 32-byte cell instance and one 32-byte glyph
instance per retained visible cell. Background, selection, search highlights,
cursor coverage, and every text decoration are generated by one procedural cell
pass. A 120 by 40 viewport therefore retains 300 KiB at exact capacity before
bounded allocation headroom, rather than four decoration quads plus a glyph
quad per cell.

The glyph atlas is fixed-budget and shared. Normal text uses a 1024 by 1024
single-channel coverage texture. Native color glyphs allocate a separate 512 by
512 RGBA texture only when first used. The matching fixed CPU mirrors cost 1 MiB
each and make atlas recovery deterministic. Dirty atlas rectangles are copied
through 256-byte-aligned mapped staging buffers and encoded into the same frame
submission as rendering. This avoids the inconsistent `GPUQueue.writeTexture`
support in older WebKit WebGPU implementations and performs no upload after an
atlas is warm. Atlas eviction is deterministic and the runtime never retains
more than eight active atlases. Panes normally share one font and scale atlas.
If a contended atlas fills, only the glyph-heavy pane moves to an isolated
atlas, leaving the other panes and their instance UVs valid. Cold glyphs may be
reset only after the atlas is isolated. This prevents cross-pane reset storms
without charging every pane for a private atlas in the common case. Only one
unused atlas is kept warm, and it is released after 30 seconds.

## Current vertical-slice status

Implemented in the Terax branch:

- one persistent libghostty-vt model per Ghostty terminal session;
- raw binary PTY output, input, and terminal reply transport;
- shared low-power WebGPU device, pipelines, scheduler, and bounded atlases;
- damage-based row uploads and event-driven presentation;
- one render-state synchronization per presentation rather than per PTY chunk;
- device-loss recovery and explicit GPU resource disposal;
- asynchronous shader validation, uncaptured validation error reporting, and
  live WebGPU-to-WebGL failover that preserves the model, PTY, and scrollback;
- bounded scrollback with wheel, trackpad, and native scrollbar navigation;
- character, word, line, rectangular, and drag-auto-scroll selection;
- clipboard copy and bracketed paste;
- terminal-controlled block, underline, and bar cursor styles and blinking;
- bounded parser-owned semantic events with secure OSC 7 and OSC 52 routing;
- parser-owned OSC 8 link activation through Terax's external URL policy;
- parallel font, WASM, and low-power WebGPU initialization with per-session
  startup-stage diagnostics;
- allocation-free packed RGB reads and cached simple-glyph string creation in
  the visible-cell hot path;
- direct structure-of-arrays WASM render reads without a per-frame JavaScript
  viewport repack;
- retained WebGL glyph buffers with dirty-row uploads and exact uploaded-byte
  diagnostics;
- live fractional fitting for font, zoom, letter spacing, and device-scale
  changes without terminal-model recreation;
- incremental Ghostty-owned scrollback search with viewport-only highlight
  storage;
- native color emoji through a lazy, fixed-budget WebGL RGBA atlas while normal
  text remains in the compact single-channel atlas;
- native color emoji through the same lazy coverage and color atlas split in
  WebGPU;
- packed 32-byte WebGPU cell and glyph records with bounded aligned capacity
  growth, one interleaved allocation, and dirty-row-only uploads;
- one procedural WebGPU background and decoration pass plus one glyph pass per
  surface, recorded into one window submission;
- extended underline styles and colors, overline, inverse, faint, text blink,
  graphemes, and wide-cell rendering;
- synchronized-output presentation suppression with bounded recovery,
  including presentation-time checks that retain the last complete frame when
  a resize was queued before Fish started its repaint transaction;
- capability-gated WebGPU default, live Ghostty WebGL failover, WebGPU device
  quarantine, and explicit xterm WebGL fallback;
- post-merge Ghostty module-global WASM page pooling, capacity-aware render
  bridge buffers, bounded transient bridge storage, and release of an idle
  high-water WASM instance after the final Ghostty model closes;
- selection tracking that survives continuous agent output and is reconciled
  against scrollback pruning, resize reflow, and alternate-screen transitions;
- retained WebGL cell-buffer capacity with bounded growth, avoiding typed-array
  allocation churn during adjacent pane-resize steps;
- one shared fit calculation for WebGPU and WebGL. ResizeObserver only retains
  its newest content-box sample, without mutating the live terminal or adding a
  second per-surface animation loop;
- atomic resize presentation: the shared renderer frame applies Ghostty reflow,
  renderer grid geometry, canvas CSS and intrinsic dimensions, the full resized
  cell upload, and the draw as one transaction. Intermediate observer samples
  are discarded, and old pixels are never compositor-scaled or cleared before
  the replacement frame is ready;
- terminal-colored surface roots that cover fractional-cell remainders while
  panes are moving, plus backing-store resize counters for release diagnostics;
- trailing PTY resize coalescing that resets pending state when a PTY generation
  is replaced; the replacement opens at the model's current dimensions. It uses
  the same 256 ms shell notification policy as xterm. The scheduler is owned by
  the terminal session rather than a renderer, so surface detach or
  WebGPU-to-WebGL failover cannot bypass it. Pane layout changes additionally
  form an explicit separator interaction transaction:
  local Ghostty reflow and GPU fit remain live, while PTY delivery is suspended
  from pointer-down until pointer-up and the trailing quiet period. This
  prevents slow or paused drags from signaling Fish mid-gesture;
- OSC 133 prompt presentation transactions with a bounded watchdog, allowing
  Fish and Starship output to parse immediately while presenting multi-chunk
  prompt redraws atomically;
- explicit pointer ownership between split separators and terminal selection,
  with a 12 px desktop hit target so near-edge drags cannot become cell
  selections;
- zero-side-effect core and renderer diagnostics for WASM, atlas, context,
  buffer, upload, and frame accounting;
- differential official-libghostty coverage for one-byte PTY chunks and resize
  reflow, while the official core remains behind the compatibility gate;
- renderer-neutral terminal targeting, prompt-preserving clear, mode-aware
  submission, macOS Option composition, and cell-deduplicated mouse motion;
- lazy xterm fallback loading, with xterm JavaScript, CSS, addons, and the
  renderer pool excluded from the Ghostty startup graph.

Still required before production default:

- title, bell, notification, and Terax block product integration;
- plain-text URL detection, accessibility, and Kitty graphics;
- broader IME, shell, TUI, platform, sleep/wake, and device-loss validation;
- release resource benchmarks against xterm WebGL using identical workloads.

## Compatibility gates

The new backend cannot become the default until all rows pass on macOS, Windows, and Linux where applicable.

| Area | Required behavior |
| --- | --- |
| Shell startup | zsh, bash, fish, pwsh, Windows PowerShell, cmd, WSL |
| Device replies | DA1, DA2, DSR 5, DSR 6, synchronized output |
| Input | Ctrl and Alt chords, function keys, Kitty keyboard, IME, dead keys |
| Display | true color, 256 color, inverse, faint, underline, strike, wide glyphs, emoji |
| TUI | Codex, Claude Code, vim, neovim, tmux, htop, fastfetch |
| Scrollback | wheel, trackpad, keyboard, scrollbar, wrapped lines, resize reflow |
| Selection | character, word, line, drag outside viewport, copy |
| Integration | OSC 7, OSC 52, OSC 133, title, links, notifications |
| Terax blocks | markers, ranges, decorations, sticky headers, block search |
| Lifecycle | tabs, split panes, hidden streaming, close, respawn, sleep and wake |
| Recovery | GPU device loss, font change, scale change, window move |
| AI APIs | buffer reads, selection reads, writes, interrupts, foreground checks |

## Resource budgets

Measurements use production builds and identical scripted workloads. Report both process RSS and backend-owned counters.

- Idle rendering: zero scheduled frames except an enabled focused cursor blink.
- Glyph atlas: fixed configured budget per active font and scale key.
- GPU instance buffers: 256-cell-aligned growth with 12.5 percent initial
  headroom, 50 percent subsequent headroom, a 262,144-cell hard limit, and
  release on hidden surfaces.
- Pending PTY output: existing 4 MiB Rust cap.
- Pending PTY input: bounded queue with byte accounting.
- Scrollback: user setting with a hard validated maximum.
- Hidden leaves: no canvas presentation and no cursor timers.
- Closed leaves: model, event queues, surface, and references are released.

## Benchmark matrix

Run xterm WebGL and Ghostty WebGPU from the same commit and settings.

1. Cold launch to first prompt.
2. Warm launch to first prompt.
3. Idle focused and idle unfocused for five minutes.
4. `cat` a 100 MiB ANSI fixture.
5. Scroll a full retained history continuously.
6. Run fastfetch repeatedly.
7. Run Codex or Claude Code for a fixed scripted session.
8. Open 1, 5, 10, and 20 terminal tabs.
9. Stream into hidden tabs and switch rapidly.
10. Suspend, wake, move between scale factors, and force GPU recovery.

Record launch latency, frame time percentiles, main-thread long tasks, PTY throughput, RSS, WASM linear memory, GPU allocations, idle CPU, and macOS energy impact or platform equivalent.

## Rollout

1. [Complete] Vendor, patch, pin, and test the low-level core.
2. [Complete] Add backend contracts and a runtime backend flag.
3. [Complete] Run a standard terminal leaf on Ghostty WebGPU with xterm fallback.
4. [In progress] Add scrollback, selection, search, links, and accessibility.
   Scrollback, selection, Ghostty search, and OSC 8 links are complete.
5. [Pending] Add shell semantic events and block mode.
6. [In progress] Use persistent models and shared GPU surfaces. Multi-pane lifecycle validation remains.
7. [Pending] Run the release benchmark and full compatibility matrix.
8. [In progress] Ghostty WebGPU is the capability-gated branch default with
   Ghostty WebGL and xterm WebGL fallbacks; stable-release selection remains
   gated on measured results.
