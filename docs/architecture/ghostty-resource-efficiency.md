# Ghostty resource efficiency

This pass addresses avoidable presentation churn, GPU backlog, and resource
ownership around desktop transitions, occlusion, and sleep. It does not yet
attribute the reported Activity Monitor spike to a specific process or prove
multi-day application memory and energy stability.

The [final September 7 audit](ghostty-final-audit-2026-09-07.md) adds startup and
presentation-view cleanup, repeats both core profiles and block stress variants,
and records the remaining limits of the resource evidence.

## September 7 allocation and redundant-work pass

The baseline is `0e3fae9`. The current core is built from Ghostty
`f426f6f181ba95f45d33f683fb754b6359d9e04f`, with identical Terax semantics and
both SIMD and scalar variants. The inspected upstream release list has a
[nightly WASM artifact](https://github.com/ghostty-org/ghostty/releases/tag/tip),
but no tagged stable standalone libghostty WASM release. The
[source comparison](https://github.com/ghostty-org/ghostty/compare/349f026087d948f8f898dca3231ff91438f83ab8...f426f6f181ba95f45d33f683fb754b6359d9e04f)
includes page allocation and fixed terminal memory reductions. Upstream alone
saved only one 64 KiB WASM page in the 20-model allocation test, so its native
allocation claims are not used as Terax memory or CPU claims.

The larger changes are in Terax's resource ownership and presentation:

- Native renderer cell arrays are created on first presentation. Reclamation
  frees those arrays and the grapheme, hyperlink and placement snapshots while
  retaining parser, scrollback, selection and command pins. Later hidden writes
  and resizes do not recreate presentation. Failed handle allocation also cleans
  up the previously allocated native terminal.
- WebGPU skips unchanged uniform uploads and presentation texture acquisition.
  WebGL skips unchanged draws and cursor uploads. Context recovery invalidates
  the cursor cache so a restored buffer is populated before drawing.
- Text-only partial WebGL updates no longer rebuild all background rectangles
  when background and decoration state is unchanged. Empty rectangle sets do
  not allocate zero-length GPU stores.
- Cursor and text timers stop when the window is unfocused. Native hidden
  cursors stop their blink timers. Focus restoration uses one damage request
  when a hidden blink phase needs to become visible.
- Short visibility pauses redraw retained GPU data without repacking cells.
  Sustained WebGPU reclamation unconfigures the canvas before shrinking it,
  avoiding a configured resize immediately before teardown. This addresses
  owned allocation churn, not proven compositor or Activity Monitor behavior.
- Selection updates merge the affected old and new row ranges without syncing
  native render state or invalidating text caches. Unchanged scrollbar state
  causes no DOM writes. Active search coalesces output invalidations into one
  scheduled step and stops that work while hidden.
- The WebGL surface, renderer and shaders are outside the primary terminal's
  static import graph. Import completion and failure are checked against the
  session generation, model and surface before installing a fallback. Closing
  or replacing the session while loading cannot revive old resources.

Allocation measurements for blank 120x40 terminal models, before first render:

| Models | Baseline WASM | Candidate WASM |
| ---: | ---: | ---: |
| 1 | 2.250 MiB | 1.938 MiB |
| 5 | 5.000 MiB | 3.688 MiB |
| 10 | 8.500 MiB | 5.938 MiB |
| 20 | 15.438 MiB | 10.375 MiB |

Twenty models save 5.0625 MiB, or 32.8% of this measured WASM allocation.
WASM linear memory cannot shrink while its instance is alive; released storage
is reusable by other models and later presentations. These numbers are not
total application RSS or the cost of 20 simultaneously rendered panes.

The [profile report](ghostty-resource-profile-2026-09-07.json) records exact
artifact hashes and raw timings. Each artifact and revision runs in a fresh
Node process to avoid the order sensitivity seen when several WASM instances
shared JavaScript call sites. Median times for 10,000 updates:

| Variant | Workload | Baseline | Candidate |
| --- | --- | ---: | ---: |
| SIMD | One-row editing | 10.72 ms | 10.89 ms |
| SIMD | Scrolling output | 217.24 ms | 220.58 ms |
| SIMD | OSC prompt events | 6.69 ms | 6.78 ms |
| Scalar | One-row editing | 10.86 ms | 10.84 ms |
| Scalar | Scrolling output | 218.96 ms | 215.47 ms |
| Scalar | OSC prompt events | 6.68 ms | 6.83 ms |

These short core timings are effectively near-neutral; they do not measure the
avoided GPU, DOM or search work. The [paired stress report](ghostty-resource-soak-2026-09-07.json)
records 655,360 writes and 62,684,160 bytes per variant with command tracking,
scrollback, Unicode, hyperlinks, resize and presentation release. Both baseline
and candidate finish at 68.125 MiB with zero growth in the final 16 samples.
Single-run timings vary and do not establish a sustained application CPU gain.
The first longer SIMD run took 14.42 seconds versus 13.61 seconds at baseline.
A fresh-process repeat with candidate first took 13.799 seconds versus 13.798
seconds at baseline; both repeats retained the same memory plateau. The report
preserves both observations instead of claiming a CPU gain from one run.

Regression tests assert zero uploads and draws for 100 unchanged scheduled
frames; one-row uploads of 7,680 bytes in WebGPU and 4,800 glyph bytes in WebGL;
no cell repack after a short pause; no blink wakeups for hidden cursors or an
unfocused window; one search step for 1,000 coalesced invalidations; and selection
row damage without native render updates. Graphics tests use instrumented API
doubles, so packaged GPU timing and device behavior remain separate gates.

Reproduce the per-artifact comparison:

```sh
mkdir -p /tmp/terax-core-baseline
git show 0e3fae9:packages/ghostty-core/adapted/ghostty-vt.wasm > /tmp/terax-core-baseline/ghostty-vt.wasm
git show 0e3fae9:packages/ghostty-core/adapted/ghostty-vt-scalar.wasm > /tmp/terax-core-baseline/ghostty-vt-scalar.wasm
TERAX_PROFILE_BASELINE=/tmp/terax-core-baseline TERAX_PROFILE_REPORT=/tmp/terax-core-profile.json pnpm profile:ghostty
```

`TERAX_PROFILE_REVERSE=1` reverses revision order. Run without concurrent builds
or other heavy workloads. `TERAX_SOAK_CORE_DIR` and `TERAX_SOAK_ARTIFACT` optionally
select a preserved artifact for the longer stress test; the default still tests
both current variants. This tooling is outside the shipped application.

The final primary terminal entry and shared presentation group is 45.78 kB gzip,
versus the previous 55.94 kB combined entry. The on-demand WebGL group is 13.62
kB and has its own 15 kB budget. Total client JavaScript remains 1.42 MB gzip;
splitting changes loading cost, not whether fallback code is shipped. Exact
build and signature checks are recorded in [release readiness](ghostty-release-readiness.md).

## Window lifecycle

One shared frontend subscription combines DOM visibility with native macOS
window occlusion and workspace sleep/wake notifications. Native snapshots have
monotonic revisions so a late initial IPC response cannot overwrite a newer
event. Duplicate notifications do not restart reclamation timers. Native
observers are removed on application exit, and frontend subscriptions are
released after the final consumer closes.

AppKit reports whether any part of the window is visible. A partly covered
window remains eligible for rendering; an unfocused visible window is paced at
15 fps. This follows [NSWindow occlusion semantics](https://developer.apple.com/documentation/appkit/nswindow/occlusionstate-swift.property).
Linux and Windows currently use DOM visibility and window focus; equivalent
native covered-window reporting is not implemented there.

| State | Presentation behavior |
| --- | --- |
| Visible, focused pane | Damage-driven, at most 60 fps |
| Visible, background pane | Independent deadline, at most 30 fps |
| Visible, unfocused window | At most 15 fps per pane |
| Visible pane receiving user input | At most 60 fps, with a 150 ms interaction deadline even while unfocused |
| Hidden or fully occluded window | Frames, blink timers, search work, and selection autoscroll pause immediately |
| Invisible for less than two seconds | Retain presentation to avoid desktop-transition allocation churn |
| Invisible for at least two seconds | Release surface buffers, native render state, canvas configuration, and atlas textures; destroy WebGL contexts |
| Native sleep notification | Request immediate reclamation |
| Hidden terminal tab | Release its presentation lease immediately |

Interaction deadlines are per pane and expire without a timer. Wheel, scrollbar,
drag, and keyboard events can preempt a pending background pacing delay; they do
not schedule a frame without damage or wake hidden surfaces. Reclamation now
also unconfigures the WebGPU canvas before shrinking it to 1x1. CSS dimensions and
the pending target size survive, and exact storage returns in the next rendered
transaction. Short desktop transitions still preserve presentation unchanged.

All states retain the PTY and terminal model. The OS and webview determine when
sleep notifications reach JavaScript, so native notification delivery and
actual GPU process memory reclamation still require packaged tests.

WebGPU retains at most one unused CPU glyph cache for the existing 30-second
idle lifetime. Its coverage pixels cost 1 MiB; color pixels add 1 MiB only after
emoji use. Glyph maps add bounded metadata. Hidden caches have no GPU textures
or full raster canvas. Restoring the cache preserves glyph coordinates and
uploads only its occupied rectangle. Font and DPR changes during a pause use
current metrics when presentation resumes.

## Submission and ownership

Per-pane deadlines preserve the shared encoder while preventing focused output
from pulling background panes to 60 fps. RAF timestamps prevent callback
jitter from skipping eligible frames. Timers account for the next animation
frame instead of waiting a complete interval before requesting it.

At most two WebGPU frames await completion. Dirty work coalesces while the GPU
is behind, without generating new uploads or submissions. One
[`onSubmittedWorkDone`](https://gpuweb.github.io/types/interfaces/GPUQueue.html#onSubmittedWorkDone)
promise serves each submission and its atlas staging allocations. Replaced
atlas textures remain valid through submission, and submitted staging buffers
stay explicitly owned until completion or disposal.

Device loss releases presentation and defers device recreation while hidden.
Late device acquisition after disposal destroys the acquired device. A
replacement lost during initialization is quarantined instead of starting an
unbounded recovery loop. Existing fallback and Retry display flows retain the
model and PTY.

Additional fixes include uploading the replacement atlas after overflow,
transactional cleanup of failed texture allocations, retaining WebGL idle
reclamation while another slot is acquired, and dropping disposed CPU arrays
and raster canvas storage explicitly.

## Reproducible core stress run

Run without launching Terax:

```sh
TERAX_SOAK_REPORT=/tmp/terax-ghostty-soak.json pnpm soak:ghostty
```

The workload runs five real WASM models through 64 epochs of 2,048 updates,
including colors, Unicode, emoji, OSC 8 links, scrollback pruning, hidden
parsing, presentation release, and resize compaction. Each model has a 10,000
line / 8 MiB scrollback setting. The run crosses the 100,000 render-update
renewal threshold and asserts at most one WASM page of growth in the final
16 epochs.

One local run on Apple M5, Node 26.5.0, macOS arm64:

| Variant | Updates | Input bytes | Elapsed | Final WASM memory | Growth in final 16 samples |
| --- | ---: | ---: | ---: | ---: | ---: |
| SIMD | 655,360 | 62,069,760 | 12.96 s | 67.5 MiB | 0 bytes |
| Scalar | 655,360 | 62,069,760 | 14.32 s | 67.5 MiB | 0 bytes |

The [raw sample report](ghostty-resource-soak-2026-09-05.json) preserves the
recorded timeline and CPU measurements.

These are accelerated core measurements, excluding IPC, WebKit, GPU, total app
RSS, and energy. Node RSS in the optional JSON report is labeled separately;
the variants run sequentially in one process, so that RSS cannot compare their
individual memory cost. WASM memory retains its allocator high-water mark while
models remain alive. The existing runtime releases the WASM instance after the
last model closes and its 60-second idle deadline expires.

Regression tests additionally cover 1,000 rapid window transitions without
surface buffer recreation, selection preservation through reclamation, font
and DPR changes while paused, two-frame GPU backlog bounds, stale native
snapshots, late cleanup, and focused/background pane pacing.

### September 6 follow-up

The [block-tracking stress report](ghostty-resource-soak-2026-09-06.json) records
655,360 updates and 62,684,160 input bytes per variant with native block pins
enabled. Both finished at 68.125 MiB of WASM memory with zero growth in the final
16 samples and 2,048 retained markers per model. This run overlapped a production
build; its approximately 26 seconds per variant is not a throughput comparison.

Selection autoscroll now stops at the history boundary, and moves within the same
selected cell do not rewrite native selection or request another redraw. Block
overlays compare their fields without serializing command/cwd metadata on every
frame. Repeated command-editor activity states do not request terminal rendering;
empty scrollbar-ruler positions do not allocate SVG command strings.

The September 6 symbol fallback added a 772,032-byte WOFF2 asset. It was removed
on September 7; current builds rely on installed fonts for private-use symbols
and retain system fallback for native color emoji.

A read-only `footprint --noCategories` sample of the existing packaged Terax host
on September 6 reported 59,934,016 bytes of physical footprint and a 63,472,960-byte
peak. This was the user's running earlier build, not the candidate built in this
pass. It excludes WebContent, GPU and compositor ownership and cannot attribute
the reported desktop-switch spike. No controlled native transition or energy
timeline was captured in this pass.

## Capturing a desktop-transition trace

Enable diagnostics in the new test build and reload:

```js
localStorage.setItem("terax:terminal-diagnostics", "1");
// After reload:
var resourceTrace = window.__teraxTermTrace();
// Switch desktops, cover/uncover the window, or sleep/wake.
// Return to the inspector, then capture the JSON:
JSON.stringify(resourceTrace.stop());
```

The recorder samples once per second and on presentation transitions. It keeps
at most 600 samples, stops automatically after ten minutes, and replaces any
previous recording. It starts no PTY workload and does not collect terminal
output. Normal startup has no recorder or sampling timer. Disable diagnostics
for final idle energy measurements, since recording has its own cost.

Compare timestamps with separately attributed Terax host, WebContent, and GPU
process memory. `await window.__teraxTermSnapshot()` adds native PTY queue
counters and host RSS; host RSS alone is not total application memory. Owned
allocation estimates must not be added to process RSS, which would double-count
memory. GPU canvas estimates exclude compositor and driver allocations.

## Earlier build verification

The final macOS arm64 candidate passed 150 frontend test files / 972 tests,
TypeScript checking, lint, 333 Rust tests, Clippy with warnings denied, and the
production application build. Lint retains the repository's 97 existing
warnings and one informational diagnostic. The local app signature verifies
with `codesign --verify --deep --strict` after ad-hoc signing.

Existing compressed size budgets pass: startup JavaScript 383.84 kB, total
client JavaScript 1.58 MB, Ghostty JavaScript 53.16 kB, and both WASM artifacts
414.8 kB. No budget was raised for this resource-efficiency pass.

## Remaining release evidence

Packaged macOS desktop changes, native occlusion, sleep/wake, mixed-DPR displays,
Fish/Starship resize, and real GPU loss need direct validation. Linux WebKitGTK
and Windows WebView2 also need platform runs. A transient process RSS spike
cannot be declared fixed solely because owned allocations are bounded.

Run matching baseline and candidate workloads with 1, 5, 10, and 20 tabs,
including hidden agent output and at least an all-day session. Record throughput,
input latency, frame cadence, host/WebContent/GPU memory, and idle/streaming
energy. Exact canvas resizing, scroll-aware GPU storage, and cold-glyph eviction
remain measured optimization candidates. This pass does not establish battery
savings or eliminate the broader migration release gates.

## Ghostty-only block workload

The final migration removes the xterm parser and compatibility resources entirely.
Block metadata retains at most 1,000 records and 512 KiB of estimated UTF-16 text;
native markers retain at most 2,048 tracked pins. Block code and UI are lazy.
Accessible text is opt-in and limited to 256 rows / 64 KiB with 250 ms coalescing.
OSC clipboard writes retain one in-flight call and the newest pending value.

Run native command tracking under the same streaming/reflow workload with:

```sh
TERAX_SOAK_BLOCKS=1 TERAX_SOAK_REPORT=/tmp/terax-block-soak.json pnpm soak:ghostty
```

The [recorded block run](ghostty-resource-soak-2026-09-05-blocks.json) uses five models,
655,360 writes and 62,684,160 bytes per artifact. SIMD completed in 13.59 seconds,
scalar in 15.29 seconds. Both plateaued at 71,434,240 bytes (68.125 MiB) of WASM
memory with zero growth in the final 16 epochs. The marker rings stayed bounded
at 2,048 pins per model. This does not measure full application RSS or battery use.
