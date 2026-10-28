"""App lab: ground-truth resource benchmark of the REAL Terax application (macOS).

Unlike scripts/renderer-profile (a synthetic renderer in a bare WKWebView) this builds the real
app, with the full React shell, real PTYs, real tabs/splits and the real window, from a source
tree compiled with the `bench` cargo feature and `TERAX_BENCH=1`. A scenario driver compiled into
that build (src/bench) runs inside the UI using the app's own tab actions and reports phase events
to this orchestrator over a local HTTP server (the scripts/pty-smoke pattern). For every event the
orchestrator samples exactly the app's own processes (host, WebContent, GPU, Networking: the pids
come from the webview itself, see src-tauri/src/modules/bench.rs), with per-category `footprint`,
`vmmap`, rusage V6 CPU/energy/wakeups, and the in-app diagnostics the driver attached.

Scenarios (`--scenario`):
  tabs           shell tab + agent tab (`--variant 4`: shell, agent, split agent+agent, shell);
                 switch tabs `--cycles` times with `--dwell-ms` dwell, sample after each switch
  resize         window drag-resize cycles with live-resize semantics (shrink/grow in steps)
  split-drag     pane divider dragged back and forth with real mouse events (shell|agent split)
  occlusion      order the window out/front `--cycles` times
  agents-steady  1 visible + `--hidden-agents` hidden agent tabs for `--duration` s (CPU/energy)
  idle           one idle shell for `--duration` s
  input          native key events / input-method calls into a PTY reader (pass/fail in page.log)

The app runs from an isolated bundle (identifier app.crynta.terax.app-lab, its own HOME), never
the user's profile; the bench build refuses to start under the product identifier. Build once
(`--build-only`, release with the feature, a separate cargo target dir) and reuse with
`--reuse-build`. To measure a pristine revision rather than the working tree use
`scripts/app-lab/export-tree.sh DEST [REV]` and pass `--source DEST`.

Every run writes one JSON report (raw samples, a 1 Hz counter timeline, derived metrics and a
human summary); `--compare A.json [B.json ...]` prints deltas (medians when repeated).
"""

import argparse
import fcntl
import hashlib
import http.server
import json
import os
import platform
import queue
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "scripts/renderer-profile"))
import app_report  # noqa: E402
import procstats  # noqa: E402

IDENTIFIER = "app.crynta.terax.app-lab"
PRODUCT_NAME = "Terax App Lab"
MAX_ATTEMPTS = 3
LOCK_PATH = Path(tempfile.gettempdir()) / "terax-app-lab.lock"
SCOPE = (
    "The real Terax application (bench build: full React shell, real PTYs and tabs, real window) "
    "in an isolated profile, driven by an in-app scenario driver; process pids come from the "
    "webview itself. A synthetic coding-agent program runs in the PTYs. Single machine, "
    "single display; not packaged-app signing, other users' fonts/shell config or cross-platform."
)
procstats.ROLE_BY_NAME["terax"] = "host"
procstats.ROLE_ORDER[:] = ["host", "web_content", "web_content_prewarmed", "gpu", "networking", "workload"]
procstats.ROLE_LABEL["workload"] = "PTY-procs"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
    p.add_argument("--scenario", choices=list(app_report.SCENARIOS))
    p.add_argument("--variant", default=None, help="tabs: 2 (default) or 4")
    p.add_argument("--source", type=Path, help="source tree to build (default: this checkout; see export-tree.sh)")
    p.add_argument("--revision", help="label for a source tree without Git metadata")
    p.add_argument("--target-dir", type=Path, help="cargo target dir (default: app-lab-target-<profile> next to --output); use a private one so the shared src-tauri/target lock is not contended")
    p.add_argument("--profile", choices=["release", "debug"], default="release", help="release (default): what users run, with the bench feature")
    p.add_argument("--build-only", action="store_true")
    p.add_argument("--reuse-build", action="store_true", help="reuse the frontend and app already built for this source/profile")
    p.add_argument("--app", type=Path, help="run this prebuilt bench .app instead of building")
    p.add_argument("--output", type=Path, help="scratch directory (default: a temp directory)")
    p.add_argument("--report", type=Path, help="JSON report path (default: <output>/report.json)")
    p.add_argument("--label", help="free-form label stored in the report")
    p.add_argument("--toggle", action="append", default=[], metavar="NAME=VALUE", help="experiment toggle: localStorage terax:bench:NAME (repeatable)")
    p.add_argument("--local-storage", action="append", default=[], metavar="KEY=VALUE", help="raw localStorage entry (VALUE 'null' removes), e.g. terax:terminal-canvas-park-ms=off")
    p.add_argument("--window", default="1280x820", help="window size in points, WxH")
    p.add_argument("--instrument", action="store_true", help="patch WebGPU/DOM prototypes with lifecycle counters (calls, wrappers created/finalized, canvas re-parenting); compare with an uninstrumented run")
    p.add_argument("--gc", nargs="?", const="private", choices=["private", "alloc"], help="after the idle tail, request a full garbage collection and sample +2 s/+10 s: 'private' (default) is WebKit's testing SPI, 'alloc' is allocation pressure from the page (what an in-app valve could do)")
    p.add_argument("--tick", type=float, help="idle, fs-churn: take a full sample (with the layer tree and the page event log) every this many seconds (fs-churn default 30)")
    p.add_argument("--unfocused", action="store_true", help="fs-churn: after measure-start move Finder to the front, so the window stays visible but is not key (an app left behind another one)")
    p.add_argument("--no-churn", action="store_true", help="fs-churn: do not start the file-system churn (dev server and explorer only)")
    p.add_argument("--churn-args", default="", help="fs-churn: extra arguments for scripts/app-lab/fs-churn.mjs run (--build-every S, --build-files N, --build-seconds S, --seed N)")
    p.add_argument("--hold-tab", type=int, help="tabs: index of the tab shown at baseline (and for the whole run with --no-switch), in creation order")
    p.add_argument("--valve", metavar="EVERY_S:CHUNKS:MB", help="mitigation probe: every EVERY_S seconds the page allocates CHUNKS zero-filled ArrayBuffers of MB MiB to push JavaScriptCore into a full GC (tabs scenario)")
    p.add_argument("--probe", choices=["blur", "readonly", "caret-transparent", "caret-animation-manual", "zero-size", "clip", "display-contents", "selection", "selection-nofocus-div"], help="idle: remove one suspected source of idle display refreshes before measuring")
    p.add_argument("--no-switch", action="store_true", help="tabs control: same loop, timing, samples and workload, but never switch tabs")
    p.add_argument("--vibrancy", choices=["on", "off"], help="set the window vibrancy preference through the app's own store before the scenario (default: the app default, off)")
    p.add_argument("--cwd-shell", type=Path, help="working directory of shell tabs; the app is launched in it, so the first tab and the file explorer start there (default: the isolated HOME)")
    p.add_argument("--cwd-agent", type=Path, help="working directory of agent tabs (different directories make the explorer and git panel follow each tab switch)")
    p.add_argument("--agent-args", default="", help="extra arguments for scripts/app-lab/agent-sim.mjs")
    p.add_argument("--cycles", type=int)
    p.add_argument("--dwell-ms", type=int, default=3000)
    p.add_argument("--hidden-ms", type=int, default=3000)
    p.add_argument("--visible-ms", type=int, default=2000)
    p.add_argument("--duration", type=float, help="measured seconds (agents-steady default 60, idle default 30)")
    p.add_argument("--warmup", type=float, default=5)
    p.add_argument("--hidden-agents", type=int, default=6)
    p.add_argument("--steps", type=int, default=120)
    p.add_argument("--step-points", type=float, default=4)
    p.add_argument("--step-interval-ms", type=float, default=16)
    p.add_argument("--drag-seconds", type=float, help="split-drag: seconds of divider motion per drag (default 6)")
    p.add_argument("--drag-amplitude", type=float, help="split-drag: sweep amplitude as a share of the split axis (default 0.2)")
    p.add_argument("--mouse-hz", type=float, help="split-drag: mouse sample rate (default 125)")
    p.add_argument("--grow-first", action="store_true", help="resize: grow the window before shrinking it (past the size the canvas was allocated for)")
    p.add_argument("--resize-mode", choices=["live", "plain"], default="live")
    p.add_argument("--vmmap", action=argparse.BooleanOptionalAction, default=None, help="`vmmap -summary` of WebContent and GPU per sample (default: on for tabs/resize/occlusion; it briefly suspends the target)")
    p.add_argument("--iosurfaces", action="store_true", help="list the IOSurface regions of WebContent and GPU (`vmmap -v`: count, sizes, volatile) in every full sample")
    p.add_argument("--categories", action=argparse.BooleanOptionalAction, default=True, help="keep footprint's per-category breakdown (default on)")
    p.add_argument("--poll-interval", type=float, default=1.0, help="seconds between timeline counter samples (phys_footprint, CPU, energy per process)")
    p.add_argument("--sampling", choices=["full", "light"], default="full", help="full: footprint+vmmap after every event (they briefly suspend the target and perturb it); light: only every --full-every-th cycle and the non-cycle phases are sampled with them, the rest rely on the cheap timeline (use a small --poll-interval)")
    p.add_argument("--light-phases", default=r"^(switch-\d+|cycle-\d+-(hidden|visible)|shrink-\d+|grow-\d+|drag-\d+)$", help="light sampling: regular expression of the phases that get only the cheap counters (every other phase, setup, the tail and GC samples, is sampled in full)")
    p.add_argument("--full-every", type=int, default=10, help="light sampling: still take a full sample every N cycles")
    p.add_argument("--wait-unlocked", type=float, default=0, metavar="SECONDS")
    p.add_argument("--wait-exclusive", type=float, default=1800, metavar="SECONDS", help="wait this long while another benchmark window (renderer-lab, app-lab) is running")
    p.add_argument("--max-consecutive-failures", type=int, default=3)
    p.add_argument("--timeout", type=float, help="hard lifetime of the app in seconds (default derived)")
    p.add_argument("--compare", type=Path, nargs="+", metavar="BASELINE.json")
    p.add_argument("--candidate", type=Path, nargs="+", metavar="CANDIDATE.json", help="with --compare: compare existing reports without running")
    p.add_argument("--recompute", type=Path, nargs="+", metavar="REPORT.json", help="recompute metrics and summary of existing reports")
    return p.parse_args()


def sh(*command: str) -> str:
    result = subprocess.run(command, capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ""


def session_locked() -> bool:
    import plistlib

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


def other_benchmarks() -> list[str]:
    """Benchmark windows that would steal focus or distort CPU from this one."""
    found = []
    for pid, (_, command) in procstats.process_table().items():
        name = os.path.basename(command)
        if name == "renderer-lab" or (name == "terax" and "Terax App Lab" in command and pid != os.getpid()):
            found.append(f"{name}[{pid}]")
    return found


# ---------------------------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------------------------


def build(args, source: Path, output: Path, target_dir: Path) -> Path:
    """Frontend with TERAX_BENCH=1, then the Tauri bundle with the `bench` feature. Returns the .app."""
    dist = output / "dist"
    bundle_dir = target_dir / args.profile / "bundle/macos"
    app = bundle_dir / f"{PRODUCT_NAME}.app"
    if args.reuse_build and app.exists() and (dist / "index.html").exists():
        print(f"Reusing {app}", flush=True)
        return app
    config = output / "tauri.conf.json"
    config.write_text(json.dumps({
        "productName": PRODUCT_NAME,
        "identifier": IDENTIFIER,
        "build": {"beforeBuildCommand": "", "frontendDist": str(dist)},
        "bundle": {"createUpdaterArtifacts": False},
    }))
    env = {**os.environ, "TERAX_BENCH": "1", "TERAX_BENCH_IDENTIFIER": IDENTIFIER, "CARGO_TARGET_DIR": str(target_dir)}
    started = time.monotonic()
    with (output / "build.log").open("w") as log:
        print("Building the frontend (TERAX_BENCH=1)...", flush=True)
        subprocess.run([str(source / "node_modules/.bin/vite"), "build", "--outDir", str(dist), "--emptyOutDir"], cwd=source, env=env, stdout=log, stderr=log, check=True)
        frontend_s = time.monotonic() - started
        print("Building the app (cargo %s, feature bench)..." % args.profile, flush=True)
        command = [str(source / "node_modules/.bin/tauri"), "build", "--bundles", "app", "--features", "bench", "--config", str(config)]
        if args.profile == "debug":
            command.append("--debug")
        subprocess.run(command, cwd=source, env=env, stdout=log, stderr=log, check=True)
    print(f"Built in {time.monotonic() - started:.0f}s (frontend {frontend_s:.0f}s)", flush=True)
    (output / "build-seconds.json").write_text(json.dumps({"frontend": frontend_s, "total": time.monotonic() - started}))
    if not app.exists():
        raise RuntimeError(f"build produced no {app}")
    return app


# ---------------------------------------------------------------------------------------------
# Profile isolation
# ---------------------------------------------------------------------------------------------


def clean_profile(home: Path) -> None:
    """Removes everything a previous run left for the bench identifier (never the product's)."""
    assert IDENTIFIER != "app.crynta.terax"
    shutil.rmtree(home, ignore_errors=True)
    # WebKit, Tauri and cfprefsd may resolve the user's real library even with HOME overridden.
    import pwd

    real = Path(pwd.getpwuid(os.getuid()).pw_dir)
    for base in (real / "Library/Application Support", real / "Library/WebKit", real / "Library/Caches", real / "Library/HTTPStorages", real / "Library/Saved Application State", real / "Library/Preferences"):
        for name in (IDENTIFIER, f"{IDENTIFIER}.savedState", f"{IDENTIFIER}.plist"):
            target = base / name
            if target.is_dir():
                shutil.rmtree(target, ignore_errors=True)
            elif target.exists():
                target.unlink()
    home.mkdir(parents=True, exist_ok=True)


def descendants(root: int, table: dict[int, tuple[int, str]]) -> list[int]:
    children: dict[int, list[int]] = {}
    for pid, (ppid, _) in table.items():
        children.setdefault(ppid, []).append(pid)
    found, stack = [], [root]
    while stack:
        for child in children.get(stack.pop(), []):
            found.append(child)
            stack.append(child)
    return found


# ---------------------------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------------------------


class ReportServer:
    """Receives phase events. A handler thread blocks until the main thread has sampled."""

    def __init__(self):
        self.events: queue.Queue = queue.Queue()
        self.log: list[str] = []
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _cors(self):
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "*")

            def do_OPTIONS(self):
                self.send_response(204)
                self._cors()
                self.end_headers()

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                if self.path == "/log":  # page errors and console output, no sampling handshake
                    outer.log.append(body.decode("utf-8", "replace"))
                    self.send_response(204)
                    self._cors()
                    self.end_headers()
                    return
                done = threading.Event()
                reply: dict = {}
                try:
                    outer.events.put((json.loads(body), done, reply))
                except ValueError:
                    pass
                done.wait(900)
                payload = json.dumps(reply).encode()
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.httpd.server_port}"


def _terminate(signum, frame):  # run the cleanup in `run` (kill the app, remove the profile)
    raise KeyboardInterrupt(f"signal {signum}")


def main() -> int:
    args = parse_args()
    signal.signal(signal.SIGTERM, _terminate)
    if args.recompute:
        for path in args.recompute:
            stored = app_report.load(path)
            stored["metrics"] = app_report.round_metrics(app_report.compute_metrics(stored))
            stored["humanSummary"] = app_report.summarize(stored)
            Path(path).write_text(app_report.dump(stored))
            print(f"Recomputed {path}")
        return 0
    if args.compare and args.candidate:
        print(app_report.compare([app_report.load(p) for p in args.compare], [app_report.load(p) for p in args.candidate]))
        return 0
    if platform.system() != "Darwin":
        raise SystemExit("The app lab requires macOS (footprint, vmmap, WKWebView).")
    if not args.scenario and not args.build_only:
        raise SystemExit("--scenario is required")
    source = (args.source or REPO).resolve()
    output = (args.output or Path(tempfile.mkdtemp(prefix="terax-app-lab-"))).resolve()
    output.mkdir(parents=True, exist_ok=True)
    target_dir = (args.target_dir or output.parent / f"app-lab-target-{args.profile}").resolve()
    app = args.app.resolve() if args.app else build(args, source, output, target_dir)
    if args.build_only:
        print(f"Built {app}")
        return 0
    # Only one benchmark window at a time (building is fine alongside a run).
    lock = LOCK_PATH.open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise SystemExit(f"Another app-lab run holds {LOCK_PATH}")

    if session_locked():
        deadline = time.monotonic() + args.wait_unlocked
        while session_locked() and time.monotonic() < deadline:
            time.sleep(10)
        if session_locked():
            raise SystemExit("The login session is locked, so the benchmark window cannot be visible. Unlock the screen and rerun (or pass --wait-unlocked SECONDS).")
    deadline = time.monotonic() + args.wait_exclusive
    while other_benchmarks():
        if time.monotonic() > deadline:
            raise SystemExit(f"Another benchmark window is running: {other_benchmarks()}")
        print(f"waiting for {other_benchmarks()} to finish...", flush=True)
        time.sleep(20)

    return run(args, app, source, output)


def scenario_json(args) -> dict:
    width, height = (float(v) for v in args.window.lower().split("x"))
    node = shutil.which("node")
    if not node:
        raise SystemExit("node is required for the synthetic agent")
    agent = f"exec {node} {HERE / 'agent-sim.mjs'} {args.agent_args}".strip()
    local = {}
    for entry in args.local_storage:
        key, _, value = entry.partition("=")
        local[key] = None if value == "null" else value
    for entry in args.toggle:
        key, _, value = entry.partition("=")
        local[f"terax:bench:{key}"] = value or "1"
    scenario = {
        "name": args.scenario, "variant": args.variant, "agentCommand": agent,
        "window": {"width": width, "height": height},
        "dwellMs": args.dwell_ms, "hiddenMs": args.hidden_ms, "visibleMs": args.visible_ms,
        "warmupS": args.warmup, "hiddenAgents": args.hidden_agents,
        "steps": args.steps, "stepPoints": args.step_points, "stepIntervalMs": args.step_interval_ms,
        "live": args.resize_mode == "live", "localStorage": local,
        "cwds": {k: str(v.resolve()) for k, v in (("shell", args.cwd_shell), ("agent", args.cwd_agent)) if v} or None,
        "gc": args.gc,
        "noSwitch": True if args.no_switch else None,
        "probe": args.probe,
        "valve": dict(zip(("everyS", "chunks", "chunkMb"), (float(v) for v in args.valve.split(":")))) if args.valve else None,
        "holdTab": args.hold_tab,
        "growFirst": True if args.grow_first else None,
        "dragS": args.drag_seconds, "dragAmplitude": args.drag_amplitude, "mouseHz": args.mouse_hz,
        "instrument": True if args.instrument else None,
        "tickS": args.tick if args.tick is not None else (30 if args.scenario == "fs-churn" else None),
        "unfocused": True if args.unfocused else None,
        "prefs": {"windowVibrancy": args.vibrancy == "on"} if args.vibrancy else None,
    }
    defaults = {"tabs": 40, "occlusion": 20, "resize": 3, "split-drag": 3}
    if args.cycles is not None or args.scenario in defaults:
        scenario["cycles"] = args.cycles if args.cycles is not None else defaults[args.scenario]
    if args.duration is not None:
        scenario["durationS"] = args.duration
    return {k: v for k, v in scenario.items() if v is not None}


def host_timeout(args, scenario: dict) -> float:
    if args.timeout is not None:
        return args.timeout
    name = args.scenario
    if name == "tabs":
        return scenario["cycles"] * (scenario["dwellMs"] / 1000 + 12) + 240
    if name == "occlusion":
        return scenario["cycles"] * ((scenario["hiddenMs"] + scenario["visibleMs"]) / 1000 + 12) + 240
    if name == "resize":
        return scenario["cycles"] * 40 + 300
    if name == "split-drag":
        return scenario["cycles"] * (scenario.get("dragS", 6) + 30) + 360
    return (scenario.get("durationS") or 60) + args.warmup + 240


def run(args, app: Path, source: Path, output: Path) -> int:
    home = output / "home"
    clean_profile(home)
    report_path = (args.report or output / "report.json").resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    scenario = scenario_json(args)
    timeout = host_timeout(args, scenario)
    vmmap_enabled = args.vmmap if args.vmmap is not None else args.scenario in ("tabs", "resize", "split-drag", "occlusion")
    import plistlib

    executable = app / "Contents/MacOS" / plistlib.loads((app / "Contents/Info.plist").read_bytes())["CFBundleExecutable"]

    revision = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], text=True, capture_output=True)
    has_git = revision.returncode == 0 and (source / ".git").exists()
    build_seconds = {}
    if (output / "build-seconds.json").exists():
        build_seconds = json.loads((output / "build-seconds.json").read_text())
    manifest = {
        "schema": "terax-app-lab/1",
        "scope": SCOPE,
        "config": {
            "scenario": args.scenario, "label": args.label, "profile": args.profile, "vmmap": vmmap_enabled,
            "categories": args.categories, "pollIntervalS": args.poll_interval, "hostTimeoutS": timeout,
            "scenarioJson": {k: v for k, v in scenario.items() if k != "agentCommand"},
            "agentArgs": args.agent_args, "buildSeconds": build_seconds,
        },
        "sourceRevision": revision.stdout.strip() if has_git else args.revision,
        "sourceTree": str(source),
        "platform": platform.platform(),
        "environment": {
            "chip": sh("sysctl", "-n", "machdep.cpu.brand_string"), "logicalCpus": sh("sysctl", "-n", "hw.ncpu"),
            "memoryBytes": sh("sysctl", "-n", "hw.memsize"), "macOS": sh("sw_vers", "-productVersion"), "build": sh("sw_vers", "-buildVersion"),
            "power": (sh("pmset", "-g", "batt").splitlines() or [""])[0], "thermal": sh("pmset", "-g", "therm"),
            "displays": sh("system_profiler", "SPDisplaysDataType").count("Resolution:"),
            "loadAverageStart": [round(v, 2) for v in os.getloadavg()],
        },
        "appBinarySha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
        "qualification": {"qualified": True, "failures": []},
        "warnings": [],
        "samples": [],
        "series": [],
    }

    server = ReportServer()
    window_server = procstats.find_pid("WindowServer")
    poller = procstats.Poller(args.poll_interval, window_server)
    started = time.monotonic()
    warnings: set[str] = set()
    env = {
        **{k: v for k, v in os.environ.items() if not k.startswith(("TAURI_", "VITE_", "CARGO_"))},
        "HOME": str(home), "TERAX_BENCH_ISOLATED": "1",
        "TERAX_BENCH_SCENARIO": json.dumps(scenario), "TERAX_BENCH_REPORT_URL": server.url,
        "SHELL": os.environ.get("SHELL", "/bin/zsh"),
    }
    env.pop("ZDOTDIR", None)
    log = (output / "app.log").open("w")
    churn = None
    if args.scenario == "fs-churn":
        if not args.cwd_shell:
            args.cwd_shell = output / "workspace"
            subprocess.run([shutil.which("node"), str(HERE / "fs-churn.mjs"), "prepare", str(args.cwd_shell), str(REPO)], check=True)
        scenario["cwds"] = {"shell": str(args.cwd_shell.resolve())}
        env["TERAX_BENCH_SCENARIO"] = json.dumps(scenario)
    launch_args = [str(args.cwd_shell.resolve())] if args.cwd_shell else []
    process = subprocess.Popen([str(executable), *launch_args], cwd=home, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    manifest["hostPid"] = process.pid
    # Hold the display awake (like the lab host's process assertion) so the idle timer cannot lock
    # the screen and occlude the window mid-run; -w ends it with the app.
    awake = subprocess.Popen(["caffeinate", "-d", "-i", "-u", "-w", str(process.pid)])
    poller.start()
    failed: BaseException | None = None
    consecutive_failures = 0
    final_phase = None

    light_phases = re.compile(args.light_phases)

    def after_sample(phase: str) -> None:
        """Scenario side effects that must start right after a phase was sampled."""
        nonlocal churn
        if args.scenario != "fs-churn":
            return
        if phase == "measure-start" and churn is None and not args.no_churn:
            churn = subprocess.Popen([shutil.which("node"), str(HERE / "fs-churn.mjs"), "run", str(args.cwd_shell.resolve()), *args.churn_args.split()], stdout=(output / "churn.log").open("w"), stderr=subprocess.STDOUT, start_new_session=True)
        if phase == "measure-start" and args.unfocused:
            subprocess.run(["open", "-a", "Finder"], check=False)
        if phase == "measure-end" and churn is not None:
            stop_churn()

    def stop_churn() -> None:
        nonlocal churn
        if churn is not None and churn.poll() is None:
            try:
                os.killpg(churn.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            churn.wait(timeout=10)
        churn = None

    def take_sample(event: dict) -> dict:
        native = event.get("native") or {}
        members, member_warnings = procstats.resolve_members(native)
        if "host" not in members.values():
            raise RuntimeError(f"Cannot identify the app's host process: {member_warnings}")
        warnings.update(member_warnings)
        table = procstats.process_table()
        kids = [pid for pid in descendants(process.pid, table) if pid not in members]
        ids = list(members)
        t_pre = time.monotonic_ns()
        wall = time.time()
        pre = {str(pid): app_report.compact_rusage(procstats.rusage(pid)) for pid in ids + kids}
        ws_pre = procstats.ps_cpu_ns(window_server) if window_server else None
        cycle = event.get("cycle") or 0
        light = args.sampling == "light" and bool(light_phases.match(event["phase"])) and not (args.full_every and cycle % args.full_every == 0)
        if light:
            # Counters only: no tool touches the target, so the timeline shows its own behaviour.
            roles = {str(pid): role for pid, role in members.items()}
            roles.update({str(pid): "workload" for pid in kids})
            by_role = {members[pid]: (pre[str(pid)] or {}).get("phys_footprint", 0) for pid in ids}
            poller.set_members(members)
            return {
                "phase": event["phase"], "light": True, "tMonoNs": t_pre, "tMonoNsPost": t_pre, "tWall": wall,
                "elapsedS": time.monotonic() - started, "event": app_report.slim_event(event),
                "members": ids, "roles": roles, "rusage": pre, "rusagePost": pre,
                "windowServerCpuNs": ws_pre, "windowServerCpuNsPost": ws_pre,
                "footprintByRole": by_role, "footprintTotal": sum(by_role.values()),
                "loadAverage": [round(v, 2) for v in os.getloadavg()],
            }
        raw = footprint_of(ids, output / "sample-footprint.json", args.categories)
        vmmap = {}
        if vmmap_enabled:
            vmmap = {role: app_report.compact_vmmap(procstats.vmmap_summary(pid)) for pid, role in members.items() if role in ("web_content", "gpu")}
        surfaces = {}
        if args.iosurfaces:
            surfaces = {role: app_report.vmmap_iosurfaces(pid) for pid, role in members.items() if role in ("web_content", "gpu", "host")}
        t_post = time.monotonic_ns()
        post = {str(pid): app_report.compact_rusage(procstats.rusage(pid)) for pid in ids + kids}
        ws_post = procstats.ps_cpu_ns(window_server) if window_server else None
        compact = app_report.compact_footprint(raw, members)
        roles = {str(pid): role for pid, role in members.items()}
        roles.update({str(pid): "workload" for pid in kids})
        poller.set_members(members)
        return {
            "phase": event["phase"], "tMonoNs": t_pre, "tMonoNsPost": t_post, "tWall": wall,
            "elapsedS": time.monotonic() - started, "event": app_report.slim_event(event),
            "members": ids, "roles": roles, "rusage": pre, "rusagePost": post,
            "windowServerCpuNs": ws_pre, "windowServerCpuNsPost": ws_post,
            "footprint": compact, "footprintByRole": compact["byRole"], "footprintTotal": compact["total"],
            **({"vmmap": vmmap} if vmmap else {}),
            **({"iosurfaces": surfaces} if surfaces else {}),
            "loadAverage": [round(v, 2) for v in os.getloadavg()],
        }

    try:
        deadline = time.monotonic() + timeout
        first_event_by = time.monotonic() + 120
        while True:
            try:
                event, done, reply = server.events.get(timeout=1)
            except queue.Empty:
                if process.poll() is not None:
                    raise RuntimeError(f"The app exited ({process.returncode}) before finishing; see {output / 'app.log'}")
                if time.monotonic() > deadline:
                    raise RuntimeError(f"Timed out after {timeout:.0f}s")
                if not manifest["samples"] and time.monotonic() > first_event_by:
                    raise RuntimeError(f"The scenario driver never reported (page log: {server.log[-3:]}); see {output / 'app.log'}")
                continue
            phase = event.get("phase")
            try:
                if phase == "error":
                    raise RuntimeError(event)
                if phase == "done":
                    manifest["samples"].append({"phase": "done", "tMonoNs": time.monotonic_ns(), "event": app_report.slim_event(event)})
                    final_phase = "done"
                    break
                reasons = app_report.qualify(args.scenario, phase, event)
                if reasons and event.get("attempt", 1) < MAX_ATTEMPTS and phase not in ("setup", "blank"):
                    # Focus was taken by something else just before the event: have the page bring
                    # the window back and report the same phase again instead of keeping bad evidence.
                    reply["retry"] = True
                    manifest["qualification"].setdefault("retried", []).append({"phase": phase, "reasons": reasons})
                    print(json.dumps({"phase": phase, "retry": reasons}), flush=True)
                    continue
                sample = take_sample(event)
                if reasons:
                    manifest["qualification"]["qualified"] = False
                    manifest["qualification"]["failures"].append({"phase": phase, "reasons": reasons})
                    consecutive_failures += 1
                    if consecutive_failures >= args.max_consecutive_failures:
                        locked = " (the login session is locked)" if session_locked() else ""
                        raise RuntimeError(f"Aborting after {consecutive_failures} consecutive unqualified samples{locked}: {reasons}")
                else:
                    consecutive_failures = 0
                manifest["samples"].append(sample)
                after_sample(phase)
                print(json.dumps({"phase": phase, "footprintMiB": round(sample["footprintTotal"] / 1048576, 1), **({"unqualified": reasons} if reasons else {})}), flush=True)
            finally:
                done.set()
    except BaseException as error:  # a partial report is still worth keeping
        failed = error
        manifest["incomplete"] = True
        manifest["error"] = repr(error)
    finally:
        stop_churn()
        poller.stop()
        for kill in (signal.SIGTERM, signal.SIGKILL):
            if process.poll() is not None:
                break
            try:
                os.killpg(process.pid, kill)
            except ProcessLookupError:
                break
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
        awake.terminate()
        server.httpd.shutdown()
        log.close()
        if server.log:
            (output / "page.log").write_text("\n".join(server.log))
        manifest["series"] = poller.series
        manifest["environment"]["loadAverageEnd"] = [round(v, 2) for v in os.getloadavg()]
        manifest["warnings"] = sorted(warnings)
        samples = [s for s in manifest["samples"] if "footprint" in s]
        cpus = int(manifest["environment"].get("logicalCpus") or 0)
        busiest = max((s["loadAverage"][0] for s in samples), default=0)
        if cpus and busiest > cpus / 2:
            manifest["qualification"].setdefault("advisories", []).append(
                f"system load average reached {busiest:.1f} on {cpus} logical CPUs; CPU, energy and timing figures may be inflated by other work"
            )
        if samples:
            try:
                manifest["metrics"] = app_report.round_metrics(app_report.compute_metrics({**manifest, "samples": samples}))
                manifest["humanSummary"] = app_report.summarize({**manifest, "samples": samples})
            except Exception as error:
                manifest["metricsError"] = repr(error)
        report_path.write_text(app_report.dump(manifest))
        clean_profile(home)
        shutil.rmtree(home, ignore_errors=True)
    if "humanSummary" in manifest:
        print("\n" + manifest["humanSummary"])
    if args.compare:
        print("\n" + app_report.compare([app_report.load(p) for p in args.compare], app_report.load(report_path)))
    print(f"\nSaved {report_path}")
    if failed is not None:
        raise failed
    if not manifest["qualification"]["qualified"]:
        print("Run failed qualification: keep the app window visible/focused and rerun.", file=sys.stderr)
        return 2
    return 0


def footprint_of(ids: list[int], path: Path, categories: bool) -> dict:
    command = ["footprint", "--swapped", "-j", str(path)]
    if not categories:
        command.insert(1, "--noCategories")
    for pid in ids:
        command += ["-p", str(pid)]
    subprocess.run(command, stdout=subprocess.DEVNULL, check=True)
    footprint = json.loads(path.read_text())
    path.unlink(missing_ok=True)
    if footprint.get("errors"):
        raise RuntimeError(footprint["errors"])
    return footprint


if __name__ == "__main__":
    raise SystemExit(main())
