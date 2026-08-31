# Ghostty WebGL renderer

This document defines Terax's production candidate terminal path:

```text
portable-pty bytes
  -> libghostty-vt WASM model
  -> borrowed typed render views and row damage
  -> Terax renderer lease
  -> Terax-owned, xterm-inspired WebGL renderer
```

WebGPU is selected first on supported webviews. This WebGL renderer is the
live-runtime and capability fallback for the same Ghostty model, followed by
`xterm-webgl` when a Ghostty GPU surface cannot run.

## Why the renderer is a fork

`@xterm/addon-webgl` cannot consume an independent terminal model. Its public
addon constructs a renderer around private xterm.js buffer, render, theme,
decoration, link, and browser services. Keeping an xterm.js `Terminal` behind
the addon would parse every PTY byte twice and retain two screen and scrollback
models. That would invalidate the main RAM and CPU goal.

Terax therefore adapts the renderer boundary instead of emulating xterm.js
internals. The fork keeps the proven parts of the xterm.js renderer design:

- instanced rectangle and glyph rendering;
- retained per-cell GPU glyph data with dirty-row `bufferSubData` uploads;
- retained GPU buffers and explicit resource destruction;
- context-loss detection and bounded restoration;
- device-pixel rendering and texture-atlas invalidation;
- frame-driven rendering with no idle animation loop.

Terax replaces xterm.js buffer and service dependencies with direct reads from
`GhosttyTerminalModel`. Upstream provenance, commit, package version, and the
MIT license are retained beside the adapted source in
`src/modules/terminal/ghostty/webgl`.

## Renderer pool ownership

A Ghostty model belongs to a terminal leaf and continues processing output
while hidden. A WebGL renderer belongs to the window-scoped pool and is leased
only while a pane is visible.

The first implementation uses these bounds:

- at most five simultaneous renderer slots, matching the existing Terax pool;
- one warm idle renderer slot;
- surplus idle WebGL contexts reclaimed after 30 seconds;
- one requestAnimationFrame scheduler for every Ghostty WebGL surface;
- no frame for hidden panes, clean models, or inactive cursor blink;
- hidden mounted panes immediately release their WebGL lease while their
  libghostty model keeps parsing raw PTY bytes;
- one 1024 by 1024 single-channel coverage atlas per active renderer slot;
- one lazy 512 by 512 RGBA atlas only after a color glyph is encountered;
- no glyph duplication for ANSI or true-color foreground variants;
- 262,144 visible cells as a hard per-surface safety limit.

The coverage atlas uses one byte per texel on the GPU instead of an RGBA texel.
Foreground color is applied by the glyph fragment shader. This reduces the
base atlas allocation from 4 MiB to 1 MiB per active renderer and lets the same
glyph entry serve every terminal color. The first native color emoji lazily
allocates a separate, fixed 1 MiB RGBA atlas. Sessions without color glyphs do
not pay that CPU or GPU memory cost.

Unlike the xterm renderer's whole-grid staging upload, the Ghostty WebGL path
keeps one CPU glyph grid and updates only the row ranges reported dirty by
libghostty. It does not allocate the two additional full-grid upload arrays.
At 120 by 40 cells this removes about 525 KiB of CPU staging memory per active
renderer and reduces a one-row glyph upload from 268,800 bytes to 6,720 bytes.
The renderer exposes cumulative uploaded glyph bytes in diagnostics so this
invariant can be checked in release workloads.

Atlas uploads use WebGL2 row-length and row-skip unpack state to transfer dirty
rectangles directly from the fixed CPU atlas. They do not allocate and repack a
temporary typed array when a new glyph appears. Coverage and color atlas upload
counts and byte totals are exposed in renderer diagnostics.

WebGPU follows the same hidden-pane ownership rule. Hiding a WebGPU surface
unregisters it from the frame scheduler, destroys its per-surface vertex and
uniform buffers, unconfigures its canvas, and releases its atlas reference.
The window-scoped WebGPU device and pipelines remain warm. Showing the pane
recreates only the bounded per-surface resources and performs a full redraw.

The WebGL pool has deterministic unit tests for the five-context hard limit,
single warm idle renderer, 30-second idle reclamation, hidden-webview frame
suppression, frame coalescing, cancellation after release, and transactional
rollback when renderer setup fails.

## Backend selection

The default backend is `ghostty-webgpu`. A missing or quarantined WebGPU device
routes the existing Ghostty session to `ghostty-webgl`; WebGL2 capability
failure routes the pane to `xterm-webgl`. An explicit backend can be selected
before a reload:

```js
localStorage.setItem("terax.experimental.terminal-backend", "xterm-webgl")
```

Use `ghostty-webgl` to force this renderer, or remove the key to return to the
capability-gated WebGPU default. Production builds may also set
`VITE_TERMINAL_BACKEND` to one of the three backend identifiers.

## xterm.js fallback version

The fallback is pinned to exact beta versions instead of semver ranges:

- `@xterm/xterm` 6.1.0-beta.302
- `@xterm/addon-webgl` 0.20.0-beta.298
- matching beta releases for fit, search, serialize, and web-links addons

These versions include parser fast paths, bounded control-sequence payload
handling, viewport synchronization improvements, cursor idle work reduction,
IME corrections, atlas overflow limits, and WebGL lifecycle fixes that are
important for long-running AI-agent sessions. Exact pins make the beta upgrade
reproducible and keep a moving prerelease from entering a release build.

## Maintained libghostty adaptation

The active experimental model is built from Ghostty commit
`e9db8d2b0b827be035ab75658ea9faf4f0f56d3f` in `ReleaseFast` mode. The bridge
started from the useful low-level Restty work at commit
`7700b14a7643ba9240818209ef1e0aa90d83ad77`, but the Restty application,
component model, renderer lifecycle, and package runtime are not used. Terax
owns the bridge, build, JavaScript boundary, renderers, and product integration.

The production artifact is 650,361 bytes with SHA-256
`ed4a16b152710c53039d3dd2ddbdb94e7b0ba0205c9e4d6811efb03150cd0633`.
The source pins, licenses, reproducible Zig build, artifact size, and checksum
are tracked in `packages/ghostty-core/adapted`.

The maintained bridge provides:

- one shared WASM instance with independent, explicitly disposed terminals;
- Ghostty's `TinyIo`, avoiding the threaded IO implementation in a browser;
- raw `Uint8Array` PTY input, replies, and parser-owned semantic events;
- line and byte scrollback caps, bounded replies, and a bounded event queue;
- structure-of-arrays render state borrowed directly from WASM memory;
- native Ghostty key encoding and live terminal-mode state;
- row hashes and dirty bits computed in WASM before the JavaScript boundary;
- built-in scrollback viewport control, wrapping, selection extraction,
  graphemes, OSC 8 links, and cursor state;
- DA, DSR, DECRQM, XTWINOPS, XTVERSION, OSC color, DECRQSS, and generated
  Ghostty XTGETTCAP replies, including the primary-device reply Fish waits for;
- synchronized-output presentation suppression with a bounded recovery
  watchdog;
- full foreground, background, underline color, underline style, overline,
  inverse, faint, wide-cell, and grapheme data for the renderer.

The model exposes cached typed views into the WASM arrays. The WebGL and WebGPU
renderers read those views directly, so the active path does not create a
second packed JavaScript viewport on every frame. The legacy packed view exists
only as an on-demand compatibility API and is tree-shaken from the production
path where unused. The production bundle contains the adapted artifact only,
not both the legacy and adapted WASM binaries.

The xterm fallback is behind a dynamic pane and backend-neutral session
boundary. A normal Ghostty launch does not preload xterm JavaScript, CSS,
addons, or the renderer pool. A startup-graph regression test enforces this
property while block tabs and explicit xterm sessions continue to load the full
fallback on demand.

Ghostty's incremental search API owns query matching and scrollback traversal.
Terax keeps only a viewport-sized byte mask for renderer highlights and advances
long searches in bounded animation-frame steps. Search does not copy the full
scrollback into JavaScript.

Font family, zoom, letter spacing, fractional host dimensions, and device scale
changes are fitted without recreating the terminal model. A resolution monitor
invalidates the atlas and GPU profile when a window moves between displays.
ResizeObserver content geometry feeds the same fit calculation used by WebGPU,
so the fallback cannot disagree on rows, columns, or fractional DPR rounding.
Observer samples only replace pending geometry. The shared renderer frame then
applies Ghostty reflow, WebGL grid geometry, CSS and intrinsic canvas sizing,
the full resized cell upload, and drawing as one presentation transaction. This
prevents both cleared-canvas flashes and compositor stretching of the previous
frame during continuous split dragging, while avoiding redundant WASM
pixel-size calls and renderer frames for coalesced samples.
User-driven pane layouts explicitly suspend the renderer-independent session
PTY scheduler for the entire separator gesture while continuing local Ghostty
reflow and GPU fitting. The final grid is delivered to the PTY only after
pointer release and the trailing quiet period, so a slow or paused drag cannot
trigger shell prompt repainting. Keeping this state above WebGPU and WebGL also
preserves the transaction across surface detach and renderer failover.
Both Ghostty renderers also honor parser-owned OSC 133 prompt transactions and
DEC synchronized-output mode, so framework prompts such as Starship are not
presented between their clear and final paint operations. This gate is checked
at presentation time as well as notification time, preventing an already queued
resize frame from exposing an intermediate Fish repaint. A bounded watchdog
preserves compatibility with broken or incomplete shell integrations.

## Why Canvas is not the primary renderer

Canvas2D remains useful for glyph rasterization and as a possible compatibility
renderer. It is not the primary presentation path. Terminal cells form retained
state, and libghostty already reports precise row damage. WebGL can preserve the
cell buffer and upload only those ranges, while a Canvas presentation path must
repeat more text rasterization and compositing work on the CPU. This matters for
all-day Codex and Claude Code streaming workloads. Canvas should be reconsidered
only if platform measurements show a concrete WebGL driver or energy regression.

## Automated resource evidence

The current core resource gate creates three 120 by 40 terminals, streams
5,000 Unicode-heavy agent-like lines into each, and keeps 8 MiB and 10,000-line
per-terminal limits. On the development machine used for this branch, isolated
WASM linear-memory growth remained below the 20 MiB gate. Repeated create and
dispose cycles and adjacent resize cycles are checked for allocator reuse and
stable retained capacity.

The allocator rebase was also measured with an identical five-terminal,
approximately 16 MiB-per-terminal ASCII workload. Total linear memory after
the workload fell from 20,119,552 bytes with the previous artifact to 8,978,432
bytes with the rebased artifact. These are linear-memory measurements, not
total application RSS claims.

The core microbenchmark on the same machine measured approximately 545 MB/s
for a 58,282-byte agent-streaming parse payload and about 0.041 ms to
synchronize a one-row 120 by 40 update. These are model-boundary measurements,
not end-to-end application claims. RSS, WebKit allocations, actual GPU memory,
and energy impact still require the release benchmark matrix below.

## Release gates

Ghostty WebGPU is the branch's capability-gated default and Ghostty WebGL is
its first fallback so both paths receive integration coverage. That is not a
production certification. Shipping either path as Terax's stable default still
requires the compatibility matrix in `ghostty-webgpu-migration.md` and repeated
release-build benchmarks against the other backends.

The key AI-agent workloads are:

1. Codex and Claude Code streaming for at least one hour.
2. Long synchronized-output animations and frequent cursor updates.
3. One, three, five, ten, and twenty live tabs with only visible panes leased.
4. Hidden output followed by rapid tab switching.
5. Large ANSI output, full scrollback, resize reflow, and continuous scrolling.
6. Five-minute focused and unfocused idle energy measurements.

Record total RSS, WASM memory, pool-owned CPU buffers, atlas GPU bytes, frame
count, upload count, long tasks, frame-time percentiles, idle CPU, and platform
energy impact. A switch is justified only when compatibility is equal and the
measured full-day workload is materially better.
