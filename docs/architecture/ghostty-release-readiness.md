# Ghostty release readiness

Status on 2026-09-07: Ghostty-only implementation, with packaged release validation
still open. xterm and its addons are removed. All terminals, including blocks,
use Ghostty with WebGPU or Terax WebGL. This is a testable release candidate,
not evidence of multi-platform, multi-day production certification.

The [final resource audit](ghostty-final-audit-2026-09-07.md) records the latest
lifecycle fixes, fresh allocation/stress data, a rejected native I/O experiment,
and validation of 1,155 frontend tests and 356 Rust tests. It leaves the packaged
release gates below open.

## September 7 PR review

The [review dispositions](ghostty-review-2026-09-07.md) record the initial 27 CodeRabbit
findings, fixes, and rejected suggestions. Allocation failure, renderer pool
recovery, post-exit transport draining, block search responsiveness, scrollbar
DOM work, WebGL rectangle uploads, draft retention, and accessible output were
covered in this pass. The unused migration model and input handler are removed.
Validation after merging main and applying the review fixes: 163 frontend files /
1,128 tests, 353 Rust tests, types, production build, all five asset budgets, and
Clippy pass. Lint retains 89 existing warnings and one info. Packaged platform
and long-duration resource gates below remain open.

The follow-up review of `121b3d1` adds three fixes: interruptible Unix PTY shutdown
when a descendant retains the slave, WebGL surface ownership after failed
reconfiguration/recovery, and consistent Windows home-path abbreviation. An
actual atlas encoding/submission test confirms idle cleanup already rearms without
another dirty frame. The unsafe raw-ESC paste suggestion was rejected after
checking the pinned upstream implementation.

Follow-up validation passes 165 frontend files / 1,140 tests, 356 Rust tests,
types, Clippy, lint, production build, and all asset budgets. The Unix reader has
no idle polling, but its readiness check added about 13.4% to an isolated raw
32 MiB PTY drain benchmark on macOS. This is a correctness tradeoff, not evidence
of improved application throughput; see the review report for the procedure and
limits. Packaged throughput and all-day resource measurements still gate release.

## September 7 resource pass

- Native presentation arrays and their auxiliary storage are lazy and reclaimed
  with presentation. Twenty blank 120x40 models use 10.375 MiB of WASM memory,
  down from 15.4375 MiB at `0e3fae9`. Parser and scrollback ownership remain.
- GPU and WebGL skip unchanged uploads and draws. Short window pauses reuse
  uploaded cells; cursor/text blink timers stop in unfocused windows, and
  application-hidden cursors stop their timer. WebGL text-only row updates skip
  rebuilding unchanged background rectangles. Selection row damage and search
  invalidation coalescing avoid redundant viewport work.
- WebGL is loaded on selection or fallback, with generation/model/surface
  checks around asynchronous import. Import-graph and late-import tests guard
  this boundary. Canvas teardown unconfigures before resizing, but the reported
  desktop-transition process memory spike remains unattributed.
- Ghostty is pinned to `f426f6f181ba95f45d33f683fb754b6359d9e04f`; both WASM
  variants were rebuilt and checksummed. No stable standalone libghostty WASM
  release was found in the inspected upstream list. The source update does not
  establish an application CPU or battery improvement.
- Type checking, 154 frontend files / 1,013 tests, production Vite build, all
  five asset budgets, Rust Clippy with warnings denied, and 333 Rust tests pass.
  Lint has the same 94 existing warnings and one informational diagnostic;
  all 17 changed TypeScript files are free of lint findings.
- Startup JS is 226.39 kB gzip; total client JS is 1.42 MB. The primary terminal
  entry plus shared presentation code is 45.78 kB / 56 kB, versus 55.94 kB in
  the previous combined entry. WebGL has a separate 13.62 kB / 15 kB budget.
  The combined WASM variants are 413.4 kB / 450 kB. No existing budget was raised;
  the fallback has an explicit budget instead of disappearing from accounting
  when moved to separate chunks. Total shipped JS still has its original cap.
- Both stress variants process 655,360 updates with native command pins and
  finish at 68.125 MiB of WASM with zero tail growth. A repeated isolated SIMD
  run took 13.799 seconds versus 13.798 seconds for baseline. The
  [resource report](ghostty-resource-efficiency.md) records raw samples, earlier
  timing variation, ownership tests, and measurement limits.

The final macOS arm64 candidate was built separately as
`src-tauri/target/release/bundle/macos/Terax Resource Candidate.app` to avoid
replacing the running `Terax.app`. It occupies 9,848 KiB on disk, and its local
ad-hoc signature passes `codesign --verify --deep --strict`. It was not launched
or installed. Its application identifier is unchanged, so quit the existing
Terax before switching to the candidate for manual testing.

These checks establish reproducible core/resource invariants. They do not close
packaged throughput, real GPU fault injection, macOS desktop-switch attribution,
all-day RAM/energy measurements, or Windows/Linux platform validation. A release
claim still needs those measurements; unit/API-double tests cannot replace them.

## September 7 block cleanup and font policy

- Removed the 772,032-byte bundled private-use symbol font, its build script and
  asset-specific budget. Installed Nerd Font detection remains; normal text uses
  the configured font or bundled JetBrains Mono, and native color emoji still
  use system fallback. Unavailable private-use symbols may display missing-glyph
  boxes until the user selects an installed font that contains them.
- Primary-screen `CSI 2J`, `CSI 3J`, and `RIS` now invalidate command pins during
  parsing and emit a bounded event that clears JavaScript block metadata, block
  selection and search UI. Later commands in the same PTY chunk keep their pins.
  Alternate-screen erases and selective/partial erases do not clear block history.
  Pin storage retains its bounded capacity across clears and is freed on disposal.
- Removed block scrollbar status dots, their presentation subscriptions, timers,
  SVG paths and history scans. Command exit codes and durations remain available
  in the block toolbar.
- Both rebuilt WASM artifacts pass real-core tests for fragmented clears,
  batched clear/new-command ordering, reset, alternate-screen preservation,
  repeated marker cleanup and zero clear events with block tracking disabled.
  The local `/usr/bin/clear` with `TERM=xterm-256color` emits `CSI 3J`, home,
  then `CSI 2J`, all covered by the implementation.
- Type checking, 152 frontend files / 997 tests, production Vite build and all
  four remaining size budgets pass. Lint passes with 94 existing warnings and
  one informational diagnostic; changed TypeScript files have no lint findings.
- Rust Clippy with warnings denied and all 333 Rust tests pass, including scalar
  WASM validation with SIMD instructions and types disabled.
- Size-limit: startup JS group 226.33 kB gzip, total client JS 1.42 MB gzip,
  lazy terminal JS 55.94 kB / 56 kB, combined WASM 417.32 kB / 450 kB.
  No JavaScript or WASM budget was raised. Exact artifact hashes are updated in
  the core source and `packages/ghostty-core/adapted/UPSTREAM.md`.

The rebuilt macOS arm64 application occupies 9,848 KiB (about 9.6 MiB) on disk,
down from 10,600 KiB in the September 6 font build. Its local ad-hoc signature
passes `codesign --verify --deep --strict`. This is an application-directory size,
not a compressed installer size. The app was not launched or installed during
this pass. The test candidate is at `src-tauri/target/release/bundle/macos/Terax.app`.

The readiness review checked transport credit/retry behavior, GPU submission and
atlas ownership, occlusion subscriptions, dependency removal, and CI coverage.
It did not close the release gates below. Glyph capacity recovery still rebuilds
or isolates atlases instead of evicting individual cold glyphs. Packaged fault
injection, cross-platform shell/input/accessibility checks, sustained throughput,
and attributed WebContent/GPU memory and energy remain required before claiming
production readiness. The desktop-transition RAM spike is still unattributed.

The following September 6 sections describe earlier checkpoints, including the
symbol asset removed above.

## September 6 interaction and resource verification

- Drag selection now pins the initial character through rendering and incoming
  output; an ordinary click remains unselected. Real-model tests cover forward,
  backward and fast drags, plus cancellation and history-boundary autoscroll.
- The Ctrl+C regression was reproduced against both artifacts after enabling
  Kitty keyboard mode: missing base codepoints produced literal `c`. Controller
  integration tests now assert `CSI 99;5u` in that mode, ETX after leaving it, and
  printable press/release encoding when requested. An isolated Fish 4.8.0 PTY
  probe with user configuration and history disabled confirmed foreground
  `sleep` interruption and clearing prompt input while Fish used `CSI =5u`.
- Nerd Font private-use fallback covers 10,071 symbols from the pinned Ghostty
  source. Font detection no longer mistakes `FontFaceSet.check()` for installed
  font detection. Existing selected fonts remain first in the fallback stack.
- User interaction can temporarily use focused cadence in an unfocused window;
  other panes retain their own deadlines. Hidden output and idle interaction
  still start no presentation. Reclamation releases intrinsic canvas storage.
- 153 frontend files / 974 tests, TypeScript, Vite production build and size
  budgets passed. Lint passed with 94 existing warnings and one informational
  diagnostic; temporary browser fixtures were removed before final checks.
- Rust Clippy with warnings denied and 333 Rust tests passed. The five-model
  stress run with native block pins enabled passed for both artifacts with no
  growth in its final sampling window; see the resource-efficiency report.
- The macOS arm64 `.app` built and its local ad-hoc signature passed
  `codesign --verify --deep --strict`. It occupies 10,600 KiB on disk (about
  10.35 MiB), not an installer size. The 772,032-byte symbol font accounts for
  the principal bundle increase from the previous 9,848 KiB local app.
- Main startup group: 226.34 kB gzip; total client JS: 1.42 MB gzip; lazy terminal
  JS: 55.93 kB / 56 kB gzip; combined WASM variants: 417.01 kB / 450 kB gzip.
  Symbols have their own 800 kB uncompressed asset budget. No existing JS or
  WASM budget was increased.

The computer-use permission control denied the isolated Safari check, so this
pass does not establish native WKWebView selection, font appearance, or scrolling
quality. Packaged macOS interaction, Windows/Linux coverage, desktop-transition
process attribution, and long-duration energy/resource testing remain open.

## Verified hardening

- PTY acknowledgments are cumulative parsed-byte offsets. Rust accepts only
  previously sent boundaries, tolerates duplicates and reordering, and keeps
  the 2 MiB data bound and two-chunk window during exit as well as normal output.
- Rejected acknowledgments retain progress and retry with capped backoff.
  Hung IPC calls are bounded to two; stalled delivery is visible. Asynchronous
  parsing preserves byte order, and failed parsing never returns credit.
  Permanent IPC failure requires connection recovery; it cannot be repaired by
  inventing credit or discarding protocol bytes.
- Reader EOF and condition-variable notifications share the queue mutex.
  Exit waits for all final bytes to be parsed. Session registration cannot reap
  a child solely because the child exited before registration completed.
- Windows closes ConPTY while the reader remains alive through EOF, replacing
  the 50 ms final-output heuristic. Explicit close wakes bounded queue workers.
  Input pipe writes run off the IPC dispatch thread so backpressure cannot
  prevent acknowledgment commands from executing.
- Dirty rows reuse persistent hyperlink IDs. The hash table stores offsets into
  owned URI storage, so terminal page recycling and URI-buffer reallocation do
  not invalidate keys. Full damage clears the table with the associated buffers.
- Mode snapshots retain their object identity while modes are unchanged, but
  native mode bits are refreshed before semantic callbacks and on public reads.
- SIMD and scalar WASM artifacts use the same pinned Ghostty source and bridge.
  Backend selection no longer sends non-SIMD webviews to xterm solely for SIMD.
  The loader fetches one artifact per webview.
- Diagnostics load independently of xterm. Native snapshots expose pending and
  in-flight bytes, message counts, sent and acknowledged totals, EOF, close
  status, and host RSS. Snapshot reads start no rendering or periodic sampling.
- Ghostty startup failures remain in the pane with a retry action instead of
  being routed as shell exits. Late failures cannot affect replaced sessions.
  A shell that exits during startup is not reattached as a live PTY. Initial
  fitting does not issue a redundant same-size resize immediately after spawn.
- Renderer replacement adopts the native selection immediately and transfers
  search navigation without resetting the query or advancing past a match.
  Replacement uses current font, theme, and cursor settings. Failed replacement
  releases its partial resources and retains session ownership. Exhausted WebGL
  recovery displays a Retry display action that replaces presentation without
  restarting the PTY or disposing the model.
- Shared cwd and grid-selection APIs route to the owning Ghostty session.
- Native macOS occlusion/sleep joins DOM visibility in a shared presentation
  policy. Frames stop immediately; a two-second grace avoids resource churn
  during short desktop transitions. Sustained invisibility and sleep reclaim
  presentation without losing model state.
- Per-pane deadlines use RAF timestamps, avoiding callback jitter and focused
  panes pulling background panes to 60 fps. WebGPU bounds outstanding frames
  to two, defers hidden device recovery, and owns staging and replaced textures
  through submission. Font/DPR changes apply correctly after a pause.
- A bounded warm CPU glyph cache avoids rasterizing glyphs again after short
  occlusion. Uploads cover only occupied pixels. Disposed WebGL CPU arrays and
  raster canvases are released explicitly, and idle reclamation survives other
  renderer acquisitions.
- An explicit ten-minute resource recorder retains at most 600 samples. The
  reproducible five-model WASM stress run reaches a memory plateau for both
  artifacts. See [resource efficiency](ghostty-resource-efficiency.md).

## Checkpoint verification before final migration

Completed on macOS arm64:

- Frontend type checking, 150 test files / 972 tests, production Vite build,
  and size budgets. Lint exits successfully with 97 existing warnings and one
  informational diagnostic; the added terminal files have no lint diagnostics.
- Rust Clippy with warnings denied and 333 Rust unit and integration tests.
- macOS arm64 release application compilation with `pnpm tauri build --no-bundle`.
  A local `.app` is built with updater artifact signing disabled using the
  command below. Release updater signing requires the release private key.
  Neither build validation establishes packaged GUI behavior or installer size.
- Local bundle signatures pass `codesign --verify --deep --strict` after ad-hoc
  signing the CLI and application. This is local validation, not notarization.
- Both artifacts pass the same adapted-core tests, including a 5,000-update
  persistent-link regression and growth across multiple URI buffer allocations.
- A Rust validator accepts the scalar artifact with SIMD types and instructions
  disabled and rejects the SIMD artifact under the same restriction. The SIMD
  artifact does not require relaxed SIMD.
- Startup graph checks keep xterm out of both normal startup and diagnostics.

Full Windows cross-compilation was attempted, but this host lacks the Windows
C headers required by `ring` (`assert.h` was unavailable). This is not Windows
validation. Windows, Linux, old webviews, and packaged GUI testing remain open.

### Checkpoint artifact costs

| Artifact | Raw bytes | Production Vite gzip |
| --- | ---: | ---: |
| SIMD | 705,529 | 210.59 kB |
| Scalar | 710,519 | 210.61 kB |

The scalar variant adds one artifact to the installed bundle; a running webview
loads only one. The combined `size-limit` gzip budget is 450 kB. Existing JavaScript
budgets remain unchanged. SHA-256 values and rebuild instructions live in
`packages/ghostty-core/adapted/UPSTREAM.md`.

### Isolated SIMD comparison

One local run of `pnpm bench:ghostty` on an Apple M5 with 16 GiB RAM, Node
26.5.0, and Vitest 4.1.11, with both artifacts from the same source revision,
measured:

| Operation | SIMD operations/s | Scalar operations/s |
| --- | ---: | ---: |
| Parse bounded streaming fixture | 15,619 | 9,451 |
| Write and synchronize one changed row | 1,006,074 | 831,532 |
| Synchronize unchanged viewport | 2,416,799 | 1,636,612 |

These measurements isolate core execution. They do not measure Tauri IPC,
two-message-window throughput, webview GPU presentation, process memory, energy,
or long-duration stability. Do not use them as application performance claims.

## Release gates still open

| Gate | Required evidence or implementation |
| --- | --- |
| Platform and installers | Packaged macOS 13 WKWebView, Windows WebView2/ConPTY, and Linux WebKitGTK runs; existing/missing runtime installation and offline behavior. The handoff's macOS 10.15 minimum is stale; see the platform configuration below. |
| Ghostty blocks | Native boundaries, reflow/pruning/reset, exact output, Unicode search, metadata caps, navigation, and occlusion tests pass. Validate overlay placement and shared input with real shells in packaged webviews. |
| Accessibility | Bounded accessible output, history paging, and announcements are implemented. VoiceOver, NVDA, and Orca validation remains required. |
| Product events | Plain-text URLs and OSC 8 are implemented. Title, bell, and generic notification events remain exposed by the bridge; product routing beyond existing agent notifications is not implemented. |
| Renderer recovery | Packaged GPU/context loss, recovery exhaustion, font/DPR changes, hidden panes, and sleep/wake; preserve model, PTY, selection, and history |
| Shell and input parity | Fish/Starship drag resizing, zsh, bash, pwsh, cmd, WSL, IME, dead keys, AltGr, mouse protocols, synchronized output, and agent TUIs |
| Glyph resources | Cold-glyph eviction under Unicode, emoji, and Nerd Font pressure; verify shared and isolated atlas bounds |
| Scheduling | Per-pane pacing, RAF timestamps, native macOS occlusion, and bounded submissions are implemented; packaged cadence, sleep/wake, resize churn, and other-platform occlusion still need measurements |
| Transport throughput | Packaged 100 MiB plain and ANSI output with end-to-end parsing completion and fault injection, including final output and ConPTY close |
| Memory and energy | Attributed host, WebContent, and GPU processes; 1/5/10/20 tabs, hidden streaming, sustained agents, and multi-hour or multi-day timelines |
| xterm removal | Implemented: no dependencies, addons, CSS, legacy pool, snapshots, dormant ring, or compatibility adapter remain. Renderer provenance/license files are retained. |

### Platform configuration and validation

The checked-in Tauri configuration declares macOS 13.0 as its minimum, as does
the merged `origin/main` configuration. The migration handoff's 10.15 minimum was
stale; this review did not raise the deployment target. A packaged run on macOS
13 with its WKWebView remains required before signing off that minimum.

Windows uses a per-user NSIS installer with `downloadBootstrapper`; it does not
bundle a WebView2 runtime. If the runtime is missing, installing it requires
internet access. Offline installation therefore requires a compatible runtime
to be provisioned separately beforehand. This retains the current installer
footprint; it does not provide an offline WebView2 installer. See
[Tauri's WebView2 installation modes](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options).
Validate packaged installation with an existing runtime while offline, a missing
runtime while online, and the failure behavior with a missing runtime while
offline. No `minimumWebview2Version` is configured; compatibility with older
installed runtimes still needs packaged testing before choosing a tested minimum.

Linux packages declare WebKitGTK 4.1 and GTK 3 dependencies. Packaged WebKitGTK
behavior and the oldest supported distribution/runtime combination still need
validation. The passing Linux, macOS, and Windows CI jobs on `4c59c89` exercise
compilation and automated tests; they do not run packaged GUI or installer tests.

The scalar artifact addresses the instruction-set dependency; it does not by
itself certify all supported WebKit versions or change the OS support policy.
Kitty graphics support is also incomplete and needs an explicit product decision
and implementation before it can be advertised.

## Collecting release evidence

### First local GUI pass

```sh
pnpm tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
codesign --force --sign - src-tauri/target/release/bundle/macos/Terax.app/Contents/MacOS/terax-cli
codesign --force --sign - --entitlements src-tauri/entitlements.plist src-tauri/target/release/bundle/macos/Terax.app
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/Terax.app
```

Use the new local app bundle without replacing the installed daily-driver build:
`src-tauri/target/release/bundle/macos/Terax.app`. The build shares the existing
application identifier and settings; it is not a separate user-data profile.

1. Start Fish with Starship, run several commands, then drag split boundaries
   continuously. Check prompt completeness, glyph geometry, final shell width,
   and normal colors in inactive splits.
2. Select output while an agent streams, copy it, and attach it to AI. Search
   through scrollback, switch tabs, and return to the same selection and match.
3. Run a command that emits substantial output and immediately exits its shell.
   Check the final output is delivered before the terminal exit behavior.
4. Open several tabs and splits, hide streaming tabs, minimize and restore the
   window, then close the tabs. Capture diagnostics before and after this cycle.
5. Exercise emoji, Nerd Font glyphs, OSC 8 links, IME input, bracketed paste,
   alternate-screen TUIs, and your usual coding agents.

6. Switch desktops repeatedly, cover the window completely, and sleep/wake.
   Capture a resource trace and attributed process memory using the
   [resource workflow](ghostty-resource-efficiency.md#capturing-a-desktop-transition-trace).

These checks help identify regressions in this hardening build. They do not
close the feature, platform, and sustained-resource release gates above.

### Diagnostic snapshots

Enable diagnostics, reload, and capture the following before and after each
identical workload on xterm and Ghostty builds:

```js
localStorage.setItem("terax:terminal-diagnostics", "1");
// After reload:
window.__teraxTerm();
await window.__teraxTermSnapshot();
```

`native.hostRssBytes` covers the Rust host only. Collect WebContent and GPU
process attribution separately. WASM and GPU allocation counters describe
owned allocations and must not be added blindly to process RSS because that
would double-count memory. Transport throughput uses differences in parsed or
acknowledged byte counters over elapsed time; shell timing alone can end before
the frontend finishes parsing. Keep diagnostics disabled for final idle-energy
measurements unless the cost of sampling is recorded separately.

## Final migration implementation

- Six checkpoint commits preserve the pre-migration hardening independently.
- Every leaf now owns a Ghostty model. Block history and selection survive live
  WebGPU/WebGL replacement. Failed graphics remain visible and retryable.
- Commands are anchored at parser time, bounded by 2,048 native pins and 1,000
  JavaScript records / 512 KiB estimated text metadata. Exact endpoint columns
  prevent copying subsequent commands. Native range reads preserve the viewport
  and selection; block search maps Unicode offsets to grid cells.
- Rerun uses complete submitted commands, never truncated metadata. Block
  scrollbar status marks were removed on September 7. Shells without prompt integration retain
  direct input; Bash before 4.4 explicitly declines the shared input bar.
- Block code/UI and accessible output load only when used. Both suspend when
  hidden or occluded. A closed session cannot acquire late block resources.
- Removed the xterm model, six dependencies, addons, CSS, old renderer pool,
  serialization, dormant ring, and adapter dispatch. WebGL uses software contexts
  when the webview supports them; failure remains explicit.
- Settings select Automatic/WebGL for new terminals and optional screen reader
  output. Retired renderer overrides no longer select xterm.
- Added IME, dead-key, AltGr, late clipboard disposal, bounded OSC clipboard,
  ordinary URL, block lifecycle, native range, and metadata retention coverage.
- CI now runs terminal tests on Windows and macOS in addition to Linux; this
  configuration has not been run on remote hosts during the local session.

The new block-enabled stress report is
[ghostty-resource-soak-2026-09-05-blocks.json](ghostty-resource-soak-2026-09-05-blocks.json).
It records exact artifact hashes. Both variants parse 655,360 updates across five
models and settle at 68.125 MiB WASM linear memory, with zero growth across the
last 16 epochs and exactly 2,048 retained markers per model. This measures the
native core; it excludes React, IPC, WebKit, GPU, and application energy.

### Final local verification

The Ghostty-only candidate passed on macOS arm64:

- `pnpm check-types` and 151 frontend test files / 946 tests.
- Frontend lint: successful exit, 94 existing warnings and one informational
  diagnostic. The changed terminal files introduce no lint diagnostics.
- Rust Clippy with warnings denied and all 333 unit/integration tests, including
  scalar validation with SIMD instructions and types disabled.
- Both rebuilt WASM variants pass exact block-boundary and input-mode tests.
  The real `/bin/bash` test verifies that pre-4.4 Bash retains direct input.
- Production Vite build and all existing `size-limit` budgets: total JavaScript
  1.42 MB gzip, Ghostty core/session JavaScript 54.48 kB / 55 kB, and both WASM
  variants 417.01 kB / 450 kB. Total JavaScript was approximately 1.58 MB gzip
  at the checkpoint. File-group startup totals are not full startup measurements.
- Final SIMD artifact: 707,988 bytes, 211.82 kB Vite gzip. Scalar artifact:
  713,015 bytes, 211.78 kB Vite gzip. Vite and size-limit use different gzip
  settings; use like-for-like measurements.
- Local release `.app` built with updater artifacts disabled, then ad-hoc signed
  and verified with `codesign --verify --deep --strict`. The arm64 `.app` uses
  about 9.6 MiB on disk; this is not a compressed installer-size measurement.

The candidate is at `src-tauri/target/release/bundle/macos/Terax.app`. It was not
launched or installed, and no measurements were taken from another running Terax.
This verification leaves the platform, packaged GUI, accessibility, and sustained
resource release gates above open.

## September 6 interaction polish

The local candidate restores the block stylesheet at its lazy UI entry points
and a blank row before completed-block dividers. That padding does not alter
native command ranges used by copy, selection or search.

Block chrome now updates within the corresponding renderer frame. The pane's
active state controls pacing even when its separate command editor has keyboard
focus. Scrollbar synchronization preserves fractional native scroll positions
and ignores delayed programmatic scroll events while output advances history.
This removes identified sources of scroll jitter; the terminal viewport remains
row-based, with no continuous idle animation.

Native clipboard read/write is enabled on macOS, Windows and Linux, restricted
to the main window and text commands. Application paste no longer calls WebKit's
permission-gated async clipboard API. Native context clicks temporarily expose
the model selection in the input textarea. Block editing keys, IME text and paste
route back to the shared command editor after that input receives focus. Core
regressions verify Ctrl+C byte encoding on both WASM variants and screen modes.
The exact WKWebView context menu and interactive IME behavior still require the
packaged manual platform checks above.

Hidden and occluded output now skips surface DOM updates, selection presentation
reconciliation and search-mask rebuilding. Model parsing and tracked selections
continue. No new timer or polling loop was added. These changes eliminate
identified application work; they do not establish the cause of the user's entire
desktop-transition RAM spike or measure WindowServer/WebContent/GPU process RSS.

The lazy terminal JavaScript budget increases from 55 to 56 kB gzip for native
selection-menu and prompt input routing. The total JavaScript and WASM budgets
remain unchanged. Shared scrollbar code removes duplicated renderer logic.


Local verification on macOS arm64 for this polish pass:

- 152 frontend test files / 960 tests passed; final TypeScript build passed.
- Frontend lint passed with the same 94 existing warnings and one informational
  diagnostic; focused terminal lint passed without diagnostics.
- All 333 Rust unit/integration tests passed, and Clippy passed with warnings
  denied after enabling the native clipboard plugin on desktop platforms.
- Production Vite and Tauri `.app` builds passed. Size-limit reports 55.07 kB
  terminal JavaScript / 56 kB budget, 1.42 MB total JavaScript / 1.6 MB budget,
  and 417.01 kB WASM / 450 kB budget. The startup file group is 226.34 kB gzip.
- The final local `.app` occupies 9,848 KiB (about 9.6 MiB) on disk after ad-hoc
  signing; `codesign --verify --deep --strict` passed. No installation or launch
  was performed, and no metrics were taken from the user's running application.

The interaction fixes are in `ff20d93` (native clipboard), `17e2d3d` (block
presentation and scrolling), and `efa255c` (native selection and prompt input).
The packaged manual and long-duration resource gates remain open.
