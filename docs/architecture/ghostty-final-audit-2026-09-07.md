# Ghostty final resource audit, September 7

This audit starts from `a96a77d0ddeba3f11f8742b3149ddad8be05dc92` on PR
[#1223](https://github.com/crynta/terax-ai/pull/1223). It covers terminal resource
ownership, startup cancellation, PTY backpressure and shutdown, presentation
scheduling, GPU/atlas lifetime, hidden panes, blocks, accessibility, asset
loading, upstream artifacts, and regression checks. It does not certify total
application RAM, battery life, or untested packaged platforms.

## Confirmed fixes

The implementation and regression cases are in `aef75b9`.

- An abandoned preload could retain the WASM instance indefinitely. Preloading
  now arms the existing 60-second idle release when no model owns the runtime,
  including when an attempted startup reuses a previous high-water instance.
  Creating a model cancels the release; live and pending models prevent it.
- A late loader completion could repopulate a disposed runtime and create a
  terminal after teardown. Disposal is now final, and asynchronous completion
  checks ownership before probing or publishing the core. Synchronous loader
  failures also enter the normal failure/retry path.
- If initial terminal configuration failed after native creation, the native
  handle had no owner to dispose it. The constructor now frees it before
  propagating the error, and a later startup can retry the same leaf.
- Borrowed cell readers retained a presentation view after its native storage
  was released, compacted, or destroyed. They now invalidate that view;
  presentation reacquires current cells without losing terminal text. Disposal
  also clears the model's cached plain links and block match.

Seven added real-WASM test cases cover these paths. The fixes add no recurring
polling, IPC, dependencies, or active-terminal rendering work. A released runtime
reference makes memory collectible; neither a zero diagnostic counter nor the
60-second deadline guarantees an immediate process RSS decrease.

## Resource ownership review

| Area | Checked behavior | Limit of this evidence |
| --- | --- | --- |
| PTY output | 2 MiB pending plus in-flight bytes, two chunks, cumulative acknowledgment validation, bounded retry ownership, explicit reader shutdown and post-exit failure reporting | End-to-end packaged throughput and ConPTY fault injection remain open |
| PTY input | Pending payloads capped at 256 KiB, one asynchronous write at a time, ordinary batches capped at 64 KiB; a single accepted large input can exceed that batch size | Payload limits exclude typed-array/object overhead and the one in-flight write |
| Model memory | Shared instance, bounded history and semantic markers, lazy presentation buffers, explicit release and reuse | The live WASM instance retains its high-water linear-memory size |
| Scheduling | Damage-driven frames, per-pane deadlines, hidden presentation suppression, blink suspension, two outstanding WebGPU submissions maximum | Mocked scheduling verifies ownership and deadlines, not native compositor cadence or energy |
| GPU resources | Eight WebGPU atlas entries maximum, five WebGL renderer slots, bounded warm retention, explicit upload/texture cleanup, recovery ownership checks | Drivers and swapchains have additional allocations; cold-glyph eviction remains whole-atlas rebuilding/isolation |
| Visibility | Shared macOS occlusion/sleep subscription, immediate pause, two-second retention before occlusion reclamation, immediate sleep reclamation | Desktop-switch RSS spikes remain unattributed; other platforms need packaged observation |
| Blocks/accessibility | Bounded command metadata/search and accessible text, hidden presentation suspension, no persistent DOM scrollback | Real screen readers, shell overlays and input methods need packaged verification |
| Loading | No xterm runtime/dependencies; WebGL remains lazy; unsupported SIMD selects the scalar core | Actual minimum-platform installation and graphics fallback are separate checks |

The upstream [release list](https://github.com/ghostty-org/ghostty/releases)
still exposes the mutable `tip` prerelease with WASM assets, rather than a tagged
stable standalone libghostty WASM release. This pass leaves the source pin
`f426f6f181ba95f45d33f683fb754b6359d9e04f` and both checked artifacts unchanged.

## Measurements

The checked-in [allocation/profile data](ghostty-final-audit-profile-2026-09-07.json)
and [block-enabled stress data](ghostty-final-audit-soak-2026-09-07.json) include
artifact checksums and raw samples. Runs used Node 26.5.0 on macOS arm64. Heavy
audit build/test jobs did not overlap these runs, but the workstation was not
an otherwise idle, controlled benchmark machine. The user's Terax was not
launched, replaced, or used as candidate measurement data.
The profile's directory labels are repository-relative; numerical samples and
artifact checksums are unchanged from the generated report.

Blank 120x40 model allocation, before first presentation, was identical for
both variants:

| Models | Total WASM linear memory |
| ---: | ---: |
| 0 | 1.1875 MiB |
| 1 | 1.9375 MiB |
| 5 | 3.6875 MiB |
| 10 | 5.9375 MiB |
| 20 | 10.375 MiB |

Each stress variant processed 655,360 writes / 62,684,160 input bytes across
five models with Unicode, OSC 8, styles, block pins, reflow and presentation
recycling. Both finished at **68.125 MiB WASM**, with **zero growth across the
last 16 samples** and exactly 2,048 retained markers per model. Released
presentations had zero cell/row capacity; active render-state renewal occurred.

| Variant | Stress elapsed | Process CPU, user + system | Final WASM |
| --- | ---: | ---: | ---: |
| SIMD | 17.274 s | 16.378 s | 68.125 MiB |
| Scalar | 25.957 s | 23.029 s | 68.125 MiB |

Profile timings below are medians of six measured 10,000-update samples after
one warmup, with a fresh process per artifact. Each update includes parsing,
event draining and render-state synchronization.

| Workload | SIMD | Scalar |
| --- | ---: | ---: |
| One-row edits | 13.464 ms | 13.125 ms |
| Scrolling ASCII | 296.035 ms | 254.918 ms |
| OSC prompt events | 8.443 ms | 7.820 ms |

These timings differ from prior runs and favor different variants for different
workloads. They do not establish a speedup from this audit or justify changing
artifact selection. The stress run lasts seconds, not days. Its Node RSS samples
include the test runner and earlier sequential work, and must not be interpreted
as packaged Terax memory or added to WASM allocation counters. IPC, React,
WebKit, GPU presentation and application energy are outside both harnesses.

## Rejected PTY optimization

A temporary nonblocking Unix reader prototype attempted to avoid a readiness
poll before every successful read. It also needed nonblocking writer handling
because duplicated descriptors share file status flags. The native 32 MiB drain
experiment gave these six sorted samples, in milliseconds:

```text
blocking:  242.352792 242.476750 243.849875 244.255334 246.743708 267.128167
prototype: 274.703084 275.312417 278.769750 284.389750 284.580000 284.808041
```

Using the mean of the two middle samples, that is 244.053 ms versus 281.580 ms.
It did not establish an improvement over the existing interruptible reader's
previously measured cost. The prototype was discarded, and both native source
files restored before final verification. The committed reader's known raw
drain overhead remains a correctness tradeoff and a packaged throughput gate.

## Verification and decision

- 165 frontend test files / 1,155 tests pass, including all seven added cases.
- Type checking, production Vite build and lint pass. Lint retains 89 existing
  warnings and one informational finding.
- All 356 Rust tests pass; the manual timing experiment remains ignored in the
  ordinary suite. Clippy passes with warnings denied. Frontend tests check exact
  artifact checksums; Rust validates the scalar build with SIMD disabled.
- All asset budgets pass: startup JS 228.06 kB gzip / 540 kB, total client JS
  1.43 MB / 1.5 MB, primary Ghostty JS 46.05 kB / 56 kB, lazy WebGL 14.08 kB /
  15 kB, both WASM variants 413.4 kB / 450 kB. No budget was raised.
- All seven CI jobs pass on `c5ab994`, including macOS and Windows tests:
  [exact-revision run](https://github.com/crynta/terax-ai/actions/runs/34135456841).
  CodeRabbit's follow-up found only local directory labels in the new profile
  JSON; those are now repository-relative.
- The latest CodeRabbit comment requested an explicit platform-validation row;
  the release-gate table now includes it and identifies the stale macOS 10.15
  handoff. The checked-in minimum remains macOS 13.

A fresh macOS arm64 bundle was built from `c5ab994` as
`src-tauri/target/release/bundle/macos/Terax Resource Candidate.app`. Its local
ad-hoc signature passes `codesign --verify --deep --strict`, and it occupies
9,880 KiB on disk. It was not launched or installed. This is an application
directory measurement, not an installer size or a notarized release. The bundle
retains Terax's application identifier and settings, so quit the existing Terax
before switching to it for manual testing.

The identified lifecycle defects are fixed and regression-tested. This audit
does **not** close the [packaged release gates](ghostty-release-readiness.md#release-gates-still-open):
minimum-platform installation, real shell/input/accessibility behavior, GPU fault
recovery, end-to-end bulk transport, desktop-transition attribution, and multi-hour
RAM/CPU/GPU/energy timelines. Those are required before describing the migration
as fully production-validated or maximally resource-efficient. No merge or release
was performed as part of this audit.
