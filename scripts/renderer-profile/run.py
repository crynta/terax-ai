"""Opt-in, isolated macOS WKWebView renderer lab. Never opens the user's Terax profile.

Builds the real Terax WebGPU renderer and the real Ghostty WASM models into a native WKWebView
host, drives a synthetic workload through the model write API (no PTY), and samples physical
footprint, CPU time and energy of the host plus its WebKit helpers.

Workloads (`--workload`):
  default    the original tab-switch / resize / repaint workload (footprint only)
  occlusion  repeated window occlusion (order out, cover window or miniaturize) with a longer
             hold than the 2 s reclaim delay; optional forced-GC probes
  canvas     the same occlusion cycles on a raw WebGPU canvas (no Terax renderer) to compare
             canvas teardown strategies with --variant
  move       small-step and jump window moves while terminals trickle output
  tabs       alternate between a one-pane and a four-pane tab, dwelling longer than the old
             two second idle-canvas deadline on each (tab-switch footprint trend)
  agents     Ink-like redraw + token streaming into K visible panes and H hidden models
  idle       the same panes with no output

Every run writes one JSON report (raw samples, a 1 Hz counter timeline and derived metrics)
and prints a human summary. `--compare baseline.json` prints deltas against an earlier report.
"""

import argparse
import hashlib
import http.server
import json
import os
import platform
import plistlib
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlencode

sys.dont_write_bytecode = True  # keep the repository free of __pycache__ from the sibling modules
sys.path.insert(0, str(Path(__file__).resolve().parent))
import lab_report  # noqa: E402
import procstats  # noqa: E402

LEGACY_PHASES = {"blank", "two-blank", "streamed", "switched", "resized", "repaint-start", "repainted", "hidden", "disposed", "done"}
SCOPE = (
    "Synthetic renderer in an isolated native WKWebView fed through the Ghostty model write API; "
    "not full Terax, a real PTY, React, AI streaming, IPC, packaged-app behaviour, or "
    "cross-platform qualification. WindowServer CPU is whole-system (all windows), from ps, without energy."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
    parser.add_argument("--workload", choices=["default", "occlusion", "canvas", "tabs", "move", "resize", "agents", "idle"], default="default")
    parser.add_argument("--output", type=Path, help="Scratch directory for build products (default: a temp directory)")
    parser.add_argument("--report", type=Path, help="Where to write the JSON report (default: <output>/report.json)")
    parser.add_argument("--source", type=Path, help="Optional baseline checkout; its node_modules must be installed")
    parser.add_argument("--revision", help="Commit label for a source archive without Git metadata")
    parser.add_argument("--label", help="Free-form label stored in the report")
    parser.add_argument("--reuse-build", action="store_true", help="Reuse dist/ and the app in --output when present")
    parser.add_argument("--inspect", action="store_true", help="Keep the final frame visible for three minutes (default workload only)")
    parser.add_argument("--panes", choices=[1, 4], type=int, default=1, help="Visible panes per tab (agents/idle: visible panes)")
    parser.add_argument("--compare", type=Path, nargs="+", metavar="BASELINE.json", help="Print deltas against this report (several repeated reports: per-metric medians)")
    parser.add_argument("--recompute", type=Path, nargs="+", metavar="REPORT.json", help="Recompute metrics and the human summary of existing reports from their raw samples, rewrite them and exit")
    parser.add_argument("--candidate", type=Path, nargs="+", metavar="CANDIDATE.json", help="With --compare: compare existing reports without running")
    # occlusion
    parser.add_argument("--occlusion-mode", choices=["orderout", "cover", "miniaturize", "none"], default="orderout", help="How the window is occluded (none: canvas workload only, leaves the window visible)")
    parser.add_argument("--cycles", type=int, default=40)
    parser.add_argument("--dwell-ms", type=int, default=3000, help="tabs workload: time spent on each tab per switch")
    parser.add_argument("--order", choices=["hide-first", "show-first"], default="hide-first", help="tabs workload: whether the outgoing tab releases its canvases before the incoming tab asks for them")
    parser.add_argument("--park-ms", help="Renderer tuning: idle WebGPU canvas parking delay in ms, or 'off' (renderers without the knob ignore it)")
    parser.add_argument("--variant", default="destroy", help="canvas workload: destroy, destroy-texture, remove-only, unconfigure-only, shrink-keep, unconfigure-keep, hide-keep, detach-keep (out of the DOM, still configured), resize-live (backing-store resizes with frames running), reconfigure (same canvas, new GPU device), webgl-destroy / webgl-keep (raw WebGL2 canvas)")
    parser.add_argument("--resize-steps", type=int, default=8, help="canvas workload, variant resize-live: backing-store resizes per cycle")
    parser.add_argument("--hidden-ms", type=int, help="Hold while occluded (default 3000; must exceed the 2 s reclaim delay)")
    parser.add_argument("--control-no-reclaim", action="store_true", help="Control experiment: hold only 1200 ms so the policy never reclaims, then expect no reclaim")
    parser.add_argument("--visible-ms", type=int, default=2000, help="Visible streaming time per cycle")
    parser.add_argument("--force-gc", choices=["none", "alloc", "private", "both"], default="none", help="Lab-only JS GC probe: allocation pressure, WebKit's private full-GC request, or both")
    parser.add_argument("--gc-when", choices=["end", "cycle", "both"], default="end", help="When to run the GC probe: after the final idle samples, in every hidden hold, or both")
    # move
    parser.add_argument("--steps", type=int, default=200)
    parser.add_argument("--jumps", type=int, default=50)
    parser.add_argument("--resize-mode", choices=["live", "plain"], default="live", help="resize workload: wrap each drag in NSView live-resize notifications like a user drag, or plain setFrame")
    parser.add_argument("--native-signal", action="store_true", help="resize workload: also tell the page when each drag starts and ends, like the NSWindow live-resize notifications the app forwards (renderers without the hook ignore it)")
    parser.add_argument("--no-gpu", action="store_true", help="resize workload: control run that drags the window with an empty page (no terminals, no WebGPU) to show what WebKit's live resize costs by itself")
    parser.add_argument("--idle-after", action="store_true", help="resize workload: stop all output when the last drag ends (idle terminals present no frames)")
    parser.add_argument("--scrollback-lines", type=int, default=3000, help="resize workload: lines written into each model before dragging (reflow cost)")
    parser.add_argument("--step-points", type=float, default=3)
    # agents / idle
    parser.add_argument("--hidden", type=int, default=8, help="Hidden models (agents/idle)")
    parser.add_argument("--duration", type=float, help="Measured seconds (agents default 60, idle default 30)")
    parser.add_argument("--warmup", type=float, default=5, help="Warm-up seconds before the measured window")
    parser.add_argument("--tick", type=float, default=0, help="Optional footprint sample interval inside the measured window (0 = start/end only)")
    parser.add_argument("--blink", type=int, choices=[0, 1], default=1, help="Terminal cursor blink (affects idle wakeups)")
    parser.add_argument("--vmmap", action=argparse.BooleanOptionalAction, default=None, help="Record `vmmap -summary` of the WebContent and GPU processes in every sample (default: on for occlusion and move)")
    parser.add_argument("--categories", action="store_true", help="Keep footprint's per-VM-category breakdown in every sample (slower; for diagnosis)")
    parser.add_argument("--instrument", type=int, choices=[0, 1], help="Lab-only canvas/texture lifecycle counters (default: on for occlusion, canvas and move; off for CPU workloads)")
    parser.add_argument("--poll-interval", type=float, default=1.0, help="Seconds between timeline counter samples")
    parser.add_argument("--wait-unlocked", type=float, default=0, metavar="SECONDS", help="If the login session is locked, poll this long for it to be unlocked before starting")
    parser.add_argument("--max-consecutive-failures", type=int, default=3, help="Abort a non-default workload after this many consecutive unqualified samples")
    parser.add_argument("--timeout", type=float, help="Hard host lifetime in seconds (default derived from the workload)")
    return parser.parse_args()


args = parse_args()

if args.recompute:
    for path in args.recompute:
        stored = lab_report.load(path)
        stored["metrics"] = {name: round(value, 4) if isinstance(value, float) else value for name, value in lab_report.compute_metrics(stored).items()}
        stored["humanSummary"] = lab_report.summarize(stored)
        stored.pop("metricsError", None)
        Path(path).write_text(lab_report.dump(stored))
        print(f"Recomputed {path}")
    raise SystemExit(0)
if args.compare and args.candidate:
    print(lab_report.compare([lab_report.load(p) for p in args.compare], [lab_report.load(p) for p in args.candidate]))
    raise SystemExit(0)
if platform.system() != "Darwin":
    raise SystemExit("This profile requires macOS, Xcode command line tools, and footprint.")
hidden_ms = args.hidden_ms if args.hidden_ms is not None else (1200 if args.control_no_reclaim else 3000)
expect_reclaim = not args.control_no_reclaim
if args.occlusion_mode == "none" and args.workload != "canvas":
    raise SystemExit("--occlusion-mode none is only meaningful for the canvas workload")
if args.workload == "occlusion" and expect_reclaim and hidden_ms <= 2000:
    raise SystemExit("--hidden-ms must exceed the 2000 ms presentation reclaim delay (or use --control-no-reclaim)")
if args.workload == "occlusion" and not expect_reclaim and hidden_ms >= 1900:
    raise SystemExit("--control-no-reclaim requires --hidden-ms below the 2000 ms reclaim delay")

root = Path(__file__).resolve().parent
repo = root.parent.parent
output = (args.output or Path(tempfile.mkdtemp(prefix="terax-renderer-profile-"))).resolve()
output.mkdir(parents=True, exist_ok=True)
source = (args.source or repo).resolve()
dist = output / "dist"
bundle = output / "Terax Renderer Lab.app"
executable = bundle / "Contents/MacOS/renderer-lab"
executable.parent.mkdir(parents=True, exist_ok=True)
vmmap_enabled = args.vmmap if args.vmmap is not None else args.workload in ("occlusion", "canvas", "move", "resize", "tabs")
cycling = args.workload in ("occlusion", "canvas", "tabs")
report_path = (args.report or output / "report.json").resolve()
report_path.parent.mkdir(parents=True, exist_ok=True)

duration = args.duration if args.duration is not None else (30 if args.workload == "idle" else 60)
if args.timeout is not None:
    host_timeout = args.timeout
elif args.workload == "default":
    host_timeout = 600 if args.inspect else 120
elif args.workload == "tabs":
    host_timeout = args.cycles * (2 * args.dwell_ms + 4000) / 1000 + 240
elif cycling:
    host_timeout = args.cycles * (hidden_ms + args.visible_ms + 4000) / 1000 + 240 + (240 if args.force_gc != "none" else 0)
elif args.workload in ("move", "resize"):
    host_timeout = 420
else:
    host_timeout = duration + args.warmup + 120

def session_locked() -> bool:
    """True while the login session shows the lock screen (the benchmark window cannot be visible)."""
    result = subprocess.run(["ioreg", "-n", "Root", "-d1", "-a"], capture_output=True)
    try:
        tree = plistlib.loads(result.stdout)
    except Exception:
        return False
    stack = [tree]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            if node.get("CGSSessionScreenIsLocked") is True:
                return True
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return False


if session_locked():
    deadline = time.monotonic() + args.wait_unlocked
    if args.wait_unlocked:
        print("The login session is locked; waiting for it to be unlocked...", flush=True)
    while session_locked() and time.monotonic() < deadline:
        time.sleep(10)
    if session_locked():
        raise SystemExit("The login session is locked, so the benchmark window cannot be visible. Unlock the screen and rerun (or pass --wait-unlocked SECONDS).")

# ---------------------------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------------------------

env = {**os.environ, "TERAX_PROFILE_SOURCE_ROOT": str(source), "TERAX_RENDERER_DIST": str(dist)}
if args.reuse_build and (dist / "index.html").exists() and executable.exists():
    print(f"Reusing the build in {output} (artifact hashes are recorded in the report)", flush=True)
else:
    with (output / "build.log").open("w") as log:
        subprocess.run(["pnpm", "exec", "vite", "build", "--config", str(root / "vite.config.ts")], cwd=repo, env=env, stdout=log, stderr=log, check=True)
        subprocess.run(["swiftc", "-module-cache-path", str(output / "swift-cache"), str(root / "Lab.swift"), "-o", str(executable)], stdout=log, stderr=log, check=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(dist), **kw)

    def log_message(self, *a):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()

revision = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], text=True, capture_output=True)
diff = subprocess.run(["git", "-C", str(source), "diff", "HEAD"], capture_output=True)
if (revision.returncode or not (source / ".git").exists()) and not args.revision:
    raise SystemExit("Source archives require --revision to identify the baseline")
has_git = revision.returncode == 0 and (source / ".git").exists()


def sh(*command: str) -> str:
    result = subprocess.run(command, capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ""


def environment() -> dict:
    return {
        "chip": sh("sysctl", "-n", "machdep.cpu.brand_string"),
        "logicalCpus": sh("sysctl", "-n", "hw.ncpu"),
        "memoryBytes": sh("sysctl", "-n", "hw.memsize"),
        "macOS": sh("sw_vers", "-productVersion"),
        "build": sh("sw_vers", "-buildVersion"),
        "power": sh("pmset", "-g", "batt").splitlines()[0] if sh("pmset", "-g", "batt") else "",
        "thermal": sh("pmset", "-g", "therm"),
        "rusageFlavor": "RUSAGE_INFO_V6 (V4 fallback)",
        "machTimebase": f"{procstats._timebase.numer}/{procstats._timebase.denom}",
        "loadAverageStart": [round(v, 2) for v in os.getloadavg()],
    }


config = {
    "workload": args.workload,
    "label": args.label,
    "panes": args.panes,
    "occlusionMode": args.occlusion_mode if args.workload in ("occlusion", "canvas") else None,
    "variant": args.variant if args.workload == "canvas" else None,
    "cycles": args.cycles if cycling else None,
    "hiddenMs": hidden_ms if args.workload in ("occlusion", "canvas") else None,
    "dwellMs": args.dwell_ms if args.workload == "tabs" else None,
    "order": args.order if args.workload == "tabs" else None,
    "parkMs": args.park_ms,
    "controlNoReclaim": args.control_no_reclaim if args.workload == "occlusion" else None,
    "visibleMs": args.visible_ms if args.workload in ("occlusion", "canvas") else None,
    "forceGc": args.force_gc if cycling else None,
    "gcWhen": args.gc_when if cycling and args.force_gc != "none" else None,
    "steps": args.steps if args.workload == "move" else None,
    "jumps": args.jumps if args.workload == "move" else None,
    "stepPoints": args.step_points if args.workload == "move" else None,
    "hidden": args.hidden if args.workload in ("agents", "idle") else None,
    "duration": duration if args.workload in ("agents", "idle") else None,
    "warmup": args.warmup if args.workload in ("agents", "idle") else None,
    "tick": args.tick if args.workload in ("agents", "idle") else None,
    "blink": args.blink,
    "categories": args.categories,
    "vmmap": vmmap_enabled,
    "instrument": args.instrument,
    "pollIntervalS": args.poll_interval,
    "hostTimeoutS": host_timeout,
}
manifest = {
    "schema": "terax-renderer-lab/2",
    "scope": SCOPE,
    "config": config,
    "sourceRevision": revision.stdout.strip() if has_git else args.revision,
    "revisionEvidence": "Git checkout" if has_git else "Caller-labelled source archive",
    "sourceDiffSha256": hashlib.sha256(diff.stdout).hexdigest() if has_git and diff.returncode == 0 else None,
    "platform": platform.platform(),
    "inspectionEnabled": args.inspect,
    "panesPerTab": args.panes,
    "environment": environment(),
    "artifacts": {str(p.relative_to(dist)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(dist.rglob("*")) if p.is_file()},
    "qualification": {"qualified": True, "failures": []},
    "warnings": [],
    "samples": [],
    "series": [],
    "nativeEvents": [],
}

query: dict[str, object] = {"panes": args.panes}
if args.park_ms is not None:
    query["parkMs"] = args.park_ms
if args.instrument is not None:
    query["instrument"] = args.instrument
if args.workload != "default":
    query.update({
        "workload": args.workload, "blink": args.blink,
        "mode": args.occlusion_mode, "variant": args.variant, "resizeSteps": args.resize_steps, "dwellMs": args.dwell_ms, "order": args.order, "cycles": args.cycles, "hiddenMs": hidden_ms, "visibleMs": args.visible_ms,
        "gc": args.force_gc, "gcWhen": args.gc_when, "sampleHidden": 0 if args.control_no_reclaim else 1,
        "steps": args.steps, "jumps": args.jumps, "stepPoints": args.step_points, "resizeMode": args.resize_mode, "idleAfter": 1 if args.idle_after else 0, "nativeSignal": 1 if args.native_signal else 0, "noGpu": 1 if args.no_gpu else 0, "scrollbackLines": args.scrollback_lines,
        "hidden": args.hidden, "duration": duration, "warmup": args.warmup, "tick": args.tick,
    })
url = f"http://127.0.0.1:{server.server_port}/?{urlencode(query)}" + ("&inspect=1" if args.inspect else "")
with (bundle / "Contents/Info.plist").open("wb") as info:
    plistlib.dump({"CFBundleIdentifier": "app.crynta.terax.renderer-lab", "CFBundleExecutable": "renderer-lab", "CFBundleName": "Terax Renderer Lab", "CFBundlePackageType": "APPL", "NSHighResolutionCapable": True, "TeraxLabURL": url}, info)

# ---------------------------------------------------------------------------------------------
# Sampling
# ---------------------------------------------------------------------------------------------

window_server = procstats.find_pid("WindowServer")
poller = procstats.Poller(args.poll_interval, window_server)
started = time.monotonic()
manifest_warnings: set[str] = set()


def footprint_of(ids: list[int], path: Path) -> dict:
    command = ["footprint", "--swapped", "-j", str(path)]
    if not args.categories:
        command.insert(1, "--noCategories")
    for pid in ids:
        command += ["-p", str(pid)]
    subprocess.run(command, stdout=subprocess.DEVNULL, check=True)
    footprint = json.loads(path.read_text())
    path.unlink(missing_ok=True)
    if footprint.get("errors"):
        raise RuntimeError(footprint["errors"])
    return footprint


def take_sample(event: dict) -> dict:
    """Counters first (closest to the event), then the slower footprint call, then counters again."""
    phase = event["phase"]
    members, warnings = procstats.resolve_members(event.get("native") or {})
    if "host" not in members.values():
        raise RuntimeError(f"Cannot identify the benchmark host process: {warnings}")
    manifest_warnings.update(warnings)
    ids = list(members)
    t_pre = time.monotonic_ns()
    wall = time.time()
    pre = {str(pid): procstats.rusage(pid) for pid in ids}
    ws_pre = procstats.ps_cpu_ns(window_server) if window_server else None
    footprint = footprint_of(ids, output / "sample-footprint.json")
    vmmap = {}
    if vmmap_enabled:
        vmmap = {role: procstats.vmmap_summary(pid) for pid, role in members.items() if role in ("web_content", "gpu")}
    t_post = time.monotonic_ns()
    post = {str(pid): procstats.rusage(pid) for pid in ids}
    ws_post = procstats.ps_cpu_ns(window_server) if window_server else None
    by_role: dict[str, int] = {}
    for process in footprint["processes"]:
        role = members.get(process["pid"], process["name"])
        by_role[role] = by_role.get(role, 0) + process["footprint"]
    poller.set_members(members)
    return {
        "phase": phase,
        "tMonoNs": t_pre,
        "tMonoNsPost": t_post,
        "tWall": wall,
        "elapsedS": time.monotonic() - started,
        "event": event,
        "members": ids,
        "roles": {str(pid): role for pid, role in members.items()},
        "rusage": pre,
        "rusagePost": post,
        "windowServerCpuNs": ws_pre,
        "windowServerCpuNsPost": ws_post,
        "footprint": footprint,
        **({"vmmap": vmmap} if vmmap else {}),
        "footprintByRole": by_role,
        "footprintTotal": footprint["total footprint"],
        "loadAverage": [round(v, 2) for v in os.getloadavg()],
    }


def qualify(phase: str, event: dict) -> list[str]:
    """Reasons this sample is not valid evidence for the phase it claims to measure."""
    if phase in ("blank", "done"):
        return []
    native = event.get("native") or {}
    reasons = []
    if event.get("step") == "hidden" and args.occlusion_mode != "none":
        hide = event.get("hide") or {}
        if not hide.get("ok") or not hide.get("occluded"):
            reasons.append(f"window was not occluded by '{hide.get('mode')}'")
        if native.get("occlusionVisible"):
            reasons.append("AppKit still reports the window visible during the hold")
        if event.get("visibility") != "hidden":
            reasons.append(f"document.visibilityState={event.get('visibility')} during the hold")
        reclaimed = event.get("reclaimedThisCycle", 0)
        if args.workload == "canvas":
            return reasons
        if expect_reclaim and reclaimed < 1:
            reasons.append("presentation policy did not publish reclaim during the hold")
        if not expect_reclaim and reclaimed > 0:
            reasons.append("presentation policy reclaimed during a control hold that must not reclaim")
        return reasons
    if args.workload == "occlusion" and event.get("step") == "visible" and "hiddenDiag" in event:
        # Control run: the hold was not sampled, so reclaim is judged over the whole cycle.
        hide = event.get("hide") or {}
        if not hide.get("ok") or not hide.get("occluded"):
            reasons.append(f"window was not occluded by '{hide.get('mode')}'")
        if not expect_reclaim and event.get("reclaimedThisCycle", 0) > 0:
            reasons.append("presentation policy reclaimed during a control cycle that must not reclaim")
    if not native.get("appActive"):
        reasons.append("application is not active")
    if not native.get("key"):
        reasons.append("benchmark window is not key")
    if not native.get("occlusionVisible"):
        reasons.append("window is occluded")
    if event.get("visibility") != "visible":
        reasons.append(f"document.visibilityState={event.get('visibility')}")
    gpu = event.get("gpu") or {}
    if gpu and not gpu.get("windowFocused"):
        reasons.append("renderer reports the window unfocused")
    if any(s.get("visible") and s.get("documentSuspended") for s in event.get("surfaces") or []):
        reasons.append("a visible surface is suspended")
    show = event.get("show")
    if show is not None and not show.get("ok"):
        reasons.append("window did not return to visible+key after show")
    return reasons


# ---------------------------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------------------------

command = [str(executable), url]
if args.inspect:
    command.append(str(output))
process = subprocess.Popen(
    command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    env={**os.environ, "TERAX_LAB_CONTROL": "1", "TERAX_LAB_TIMEOUT": str(host_timeout)},
)
manifest["hostPid"] = process.pid
poller.start()
failed = None
consecutive_failures = 0
try:
    with (output / "events.jsonl").open("w") as log:
        for line in process.stdout:
            log.write(line)
            log.flush()
            arrival = time.monotonic_ns()
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if "native" in event and isinstance(event["native"], str):
                event["tMonoNs"] = arrival
                manifest["nativeEvents"].append(event)
                continue
            phase = event.get("phase")
            if not phase:
                continue
            if phase == "error":
                raise RuntimeError(event)
            if args.workload == "default":
                # Legacy behaviour: strict phase list.
                if phase not in LEGACY_PHASES:
                    raise RuntimeError(f"Unknown benchmark phase: {phase}")
            elif phase == "done":
                manifest["samples"].append({"phase": "done", "tMonoNs": arrival, "event": event})
                continue
            sample = take_sample(event)
            reasons = qualify(phase, event) if args.workload != "default" else []
            if args.workload == "default" and phase in {"streamed", "switched", "resized", "repainted"} and (
                not event["gpu"]["windowFocused"] or any(s["visible"] and s["documentSuspended"] for s in event["surfaces"])
            ):
                raise RuntimeError("Keep the renderer fixture visible and focused during measurement")
            if reasons:
                manifest["qualification"]["qualified"] = False
                manifest["qualification"]["failures"].append({"phase": phase, "reasons": reasons})
                consecutive_failures += 1
                if args.workload != "default" and consecutive_failures >= args.max_consecutive_failures:
                    locked = " (the login session is locked)" if session_locked() else ""
                    raise RuntimeError(f"Aborting after {consecutive_failures} consecutive unqualified samples{locked}: {reasons}")
            else:
                consecutive_failures = 0
            manifest["samples"].append(sample)
            print(json.dumps({"phase": phase, "footprintMiB": round(sample["footprintTotal"] / 1048576, 2), **({"unqualified": reasons} if reasons else {})}), flush=True)
            if event.get("sync"):
                try:
                    process.stdin.write(f"ack {event['sync']}\n")
                    process.stdin.flush()
                except BrokenPipeError:
                    raise RuntimeError("Benchmark host exited while a sample was pending")
    last_phase = manifest["samples"][-1]["event"]["phase"] if manifest["samples"] else None
    if process.wait() != 0 or not manifest["samples"] or last_phase != "done":
        raise RuntimeError("Native renderer profile did not complete")
except BaseException as error:
    failed = error
    manifest["incomplete"] = True
    manifest["error"] = repr(error)
finally:
    poller.stop()
    if process.poll() is None:
        try:
            process.stdin.close()
        except OSError:
            pass
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=10)
    server.shutdown()
    manifest["series"] = poller.series
    manifest["environment"]["loadAverageEnd"] = [round(v, 2) for v in os.getloadavg()]
    manifest["warnings"] = sorted(manifest_warnings)
    samples = [s for s in manifest["samples"] if "footprint" in s]
    busiest = max((s["loadAverage"][0] for s in samples), default=0)
    cpus = int(manifest["environment"].get("logicalCpus") or 0)
    if cpus and busiest > cpus / 2:
        manifest["qualification"].setdefault("advisories", []).append(
            f"system load average reached {busiest:.1f} on {cpus} logical CPUs; CPU, energy and timing figures may be inflated by other work on this machine"
        )
    if samples:
        try:
            manifest["metrics"] = {name: round(value, 4) if isinstance(value, float) else value for name, value in lab_report.compute_metrics({**manifest, "samples": samples}).items()}
            manifest["humanSummary"] = lab_report.summarize({**manifest, "samples": samples})
        except Exception as error:  # a partial report is still worth keeping
            manifest["metricsError"] = repr(error)
    ordered = {key: manifest[key] for key in ("schema", "scope", "config", "sourceRevision", "revisionEvidence", "sourceDiffSha256", "platform", "inspectionEnabled", "panesPerTab", "hostPid", "environment", "qualification", "warnings", "incomplete", "error", "metrics", "metricsError", "humanSummary", "artifacts", "samples", "series", "nativeEvents") if key in manifest}
    report_path.write_text(lab_report.dump(ordered))

if "humanSummary" in manifest:
    print("\n" + manifest["humanSummary"])
if args.compare:
    print("\n" + lab_report.compare([lab_report.load(p) for p in args.compare], lab_report.load(report_path)))
print(f"\nSaved {report_path}")
if failed is not None:
    raise failed
if not manifest["qualification"]["qualified"]:
    print("Run failed qualification: keep the lab window visible/focused and rerun.", file=sys.stderr)
    raise SystemExit(2)
