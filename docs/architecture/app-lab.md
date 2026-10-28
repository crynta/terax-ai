# App lab: resource benchmark of the real application

`scripts/app-lab` measures the **real** Terax app (full React shell, real PTYs, real
tabs and splits, real window, the release profile users run) instead of the synthetic
renderer in `scripts/renderer-profile`. It exists because the renderer lab did not reproduce
what the user sees every day: memory that jumps on every tab switch and does not come back.
Reports are written to the output directory you pass; they are never committed.

Nothing of it ships. The Rust side is behind the cargo feature `bench`, the frontend behind
`TERAX_BENCH=1` (a Vite `define` that is the literal `false` otherwise, so the driver, its
lazy chunk and every bench-only string are removed before bundling). `src/app/dist-budget.test.ts`
builds the normal frontend and fails if any `bench` chunk or marker string is emitted.

## Running

```sh
# one scenario against this checkout (builds the bench app first; release, private target dir)
python3 scripts/app-lab/run.py --scenario tabs --target-dir /tmp/app-lab-target --report tabs.json

# measure a pristine revision instead of the working tree (HEAD or any rev, plus the overlay)
scripts/app-lab/export-tree.sh /tmp/app-lab-src HEAD
python3 scripts/app-lab/run.py --scenario tabs --source /tmp/app-lab-src --target-dir /tmp/app-lab-target

python3 scripts/app-lab/run.py --compare base.json [base2.json ...] --candidate cand.json
python3 scripts/app-lab/app_report.py report1.json report2.json    # one comparable line per report
```

Build time on an M4 (10 cores): cold release build including every dependency 2 min 14 s;
after a frontend or app change 88 to 90 s (the frontend itself 6 s). `--reuse-build` skips
the build, `--build-only` stops after it, `--app` runs a prebuilt `.app`.

Keep the machine awake and unlocked and do not touch the keyboard: the benchmark window must
stay visible, key and active. The orchestrator holds a display-sleep assertion
(`caffeinate -d -i -u`), refuses to start while another benchmark window (renderer lab, a second
app lab) is running or the session is locked, asks the page to bring the window back and report
a phase again when focus was taken (`qualification.retried`), and marks anything that still is
not a valid sample (`qualification.failures`). Building is fine alongside a run; CPU numbers are
not.

## Scenarios

| `--scenario` | What it does |
| --- | --- |
| `tabs` | shell tab plus agent tab (`--variant`: `sa` default, `saps` = shell, agent, split agent pair, shell, or any string of `s` shell, `b` block-mode shell, `a` agent, `p` split pair); switches `--cycles` (40) times with `--dwell-ms` (3000) dwell; baseline, one sample per switch, +10/+30 s idle |
| `resize` | one agent tab; 3 cycles of 120 live-resize steps (shrink then grow) through the web view's `viewWillStartLiveResize` / `viewDidEndLiveResize` |
| `occlusion` | window ordered out and back 20 times (3 s hidden, 2 s visible) |
| `agents-steady` | 1 visible plus 6 hidden agent tabs for 60 s |
| `idle` | one idle shell for 30 s |
| `input` | real key events and input-method calls into a raw-mode PTY reader; pass/fail lines in `page.log` (no measurements) |

Options that matter: `--window WxH` (default 1280x820 points), `--cwd-shell` / `--cwd-agent`
(different directories make the explorer and git panel follow the switch), `--vibrancy on|off`,
`--sampling light` (cheap counters only between full samples, see below), `--gc [private|alloc]`
(request a full garbage collection after the tail and sample again), `--instrument` (WebGPU, DOM
and IPC call counters with created/finalized wrapper counts), `--no-switch --hold-tab N`
(controls), `--toggle NAME=VALUE` (experiment toggles, below), `--iosurfaces` (every IOSurface
region from `vmmap -v`), `--valve EVERY_S:CHUNKS:MB` (allocation-pressure GC probe), `--probe`
(idle: remove one suspected wakeup source, e.g. `blur`), `--local-storage KEY=VALUE`.

### Experiment toggles

`--toggle NAME=VALUE` sets `localStorage["terax:bench:NAME"]` before the app starts; product code
may read it through `benchFlag` / `benchFlagOn` (`src/bench/flags.ts`, a constant `null` when
`__TERAX_BENCH__` is false). The hooks used for the tab-switch investigation touch files that
change often (`WebGpuTerminalSurface.ts`, `CanvasBackingStore.ts`, `useGhosttyTerminalSession.ts`,
`TerminalStack.tsx`), so they are kept as a patch against `ee836e1`:

```sh
scripts/app-lab/export-tree.sh /tmp/app-lab-exp HEAD
(cd /tmp/app-lab-exp && patch -p1 < scripts/app-lab/experiments/tab-switch-toggles.patch)
python3 scripts/app-lab/run.py --scenario tabs --variant saps --source /tmp/app-lab-exp \
    --target-dir /tmp/app-lab-target-exp --toggle fixed-backing=2560x1700
```

Toggles: `keep-attached` (surface stays in its pane when hidden), `keep-canvas` / `keep-gpu`
(do not release the canvas / buffers, atlas and canvas on hide), `keep-model` (skip
`releasePresentationResources`), `tab-display-none`, `fixed-backing=WxH` (every canvas gets one
backing size, so none is ever resized).

## Isolation

The bundle is `Terax App Lab.app` with the identifier `app.crynta.terax.app-lab`, launched with
its own `HOME` (so the control-server descriptor, shell-integration files and history never touch
the real user's) and `TERAX_BENCH_ISOLATED=1`. The bench binary refuses to start under the product
identifier or without that variable (`modules/bench.rs::guard`, unit tested), and the profile
directories for the lab identifier are removed before and after every run. The user's running app
is never touched. The shells are real login shells with an empty `HOME`; the agent is
`scripts/app-lab/agent-sim.mjs`, an Ink-like program (12-line region erased and rewritten every 80
ms, a spinner, 40 characters of token text every 50 ms, completed lines flushed into scrollback, a
bordered tool block every 7 s, 300 lines of history).

## What is measured

The scenario driver (`src/bench`, mounted by `App.tsx` only when `__TERAX_BENCH__`) uses the app's
own tab actions (`setActiveId`, `newTab`, `newAgentGroupTab`, `splitActivePane`) and
`whenSessionReady` / `writeToSession`. Each phase posts an event to the orchestrator's local HTTP
server (the `scripts/pty-smoke` pattern); the page waits until the orchestrator has sampled.

- Exact processes: host, WebContent, GPU and Networking pids come from the web view itself
  (`_webProcessIdentifier` and friends, `bench_window snapshot`), so attribution is exact even
  with other WebKit apps running. Children of the host (shells, node) are accounted as `PTY-procs`.
- `footprint -j` with categories per process, kept compact: `WebKit malloc`, `IOSurface` (own,
  shared groups, `reclaimable`), owned unmapped graphics, `JS VM Gigacage`, and the rest. `vmmap`
  summary for WebContent and GPU, rusage V6 CPU, energy, wakeups, instructions and cycles per
  process (the lab's `procstats`), a 0.25 to 1 s timeline of the same counters, WindowServer CPU.
- In-app diagnostics per phase: WASM linear memory per instance, canvas pool counters, surface
  backing-store resizes, GPU buffer sizes, presentation state, DOM size. The JS heap cannot be read
  (`performance.memory` does not exist in WebKit).
- Native window control (`bench_window`): stepped live resize, order out/front, miniaturize,
  native sleep, activation, and `_garbageCollectJavaScriptObjectsForTesting` for `--gc`.

Full sampling (`footprint` + `vmmap`) suspends the target for about a second per sample; the
`light` mode keeps only the cheap timeline between full samples every `--full-every` cycles, which
showed the same growth as full sampling.

## Findings that shaped the current design

- Tab switches between differently sized panes resized a presented WebGPU canvas; WebKit keeps
  every retired swapchain until JavaScriptCore collects its wrappers (minutes). Fixed by the window
  canvas (one canvas per terminal area, only viewports change): 726 -> 218 MiB over 40 switches.
- Per-frame WebGPU wrappers pin ~13 KiB of native memory JavaScriptCore does not count (~20 MiB/min
  for a streaming agent). Fixed by `gpu/GcPressure.ts`.
- A focused textarea with a collapsed selection keeps WebKit's display link running (idle 3.1 % CPU,
  254 wakeups/s). Fixed by the input proxy's selected placeholder (0.24 %, ~11/s).
- During a live window resize WebKit allocates a viewport-sized page tile per step (an empty page
  peaks at ~420 MiB). Mitigated on macOS by pinning the document to a 512 px multiple while a drag
  runs (`modules/theme/livePageResize.ts`); at rest the shell composites only the page tile, the
  terminal textarea and the canvas.
- Resizing the model and PTY during a drag made shells and Ink agents redraw per step, duplicating
  prompts and agent regions. Fixed by one synchronized resize at gesture end (see
  `terminal-renderer-v2.md`, Resizing).

Judge memory by the timeline floor and the value after `--gc`: dead native objects are released
when garbage collection runs, so single samples vary between runs.

## Limits

macOS only, one display (2048x1152 points at 100 Hz here), fresh profile with default
preferences (vibrancy off), no AI panel traffic, a synthetic agent instead of Codex. Footprint
figures vary between runs because garbage collection timing decides when dead native objects
are released; compare medians of repeats and prefer the timeline floor and the after-GC value.
