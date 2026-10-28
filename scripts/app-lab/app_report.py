"""Samples, metrics, human summaries and baseline comparison for app-lab reports.

CPU/energy intervals, tables and report (de)serialization are shared with the renderer lab
(`scripts/renderer-profile/lab_report.py`); everything else here is specific to the real
application: per-category footprint (WebKit malloc, IOSurface owned/shared/reclaimable, graphics)
per process, `vmmap` regions and the in-app diagnostics the scenario driver attached to each event.
"""

import json
import re
import statistics
import subprocess
import sys
from pathlib import Path

_RENDERER_PROFILE = Path(__file__).resolve().parent.parent / "renderer-profile"
if str(_RENDERER_PROFILE) not in sys.path:
    sys.path.insert(0, str(_RENDERER_PROFILE))
import lab_report  # noqa: E402
from lab_report import MIB, interval, slope, table  # noqa: E402

SCENARIOS = ["tabs", "resize", "split-drag", "occlusion", "agents-steady", "idle", "fs-churn", "input"]
ROLES = ["host", "web_content", "gpu", "networking"]
ROLE_LABELS = {"host": "host", "web_content": "WebContent", "gpu": "GPU", "networking": "Network", "workload": "PTY-procs", "web_content_prewarmed": "WC-prewarm"}
# Footprint categories worth a column; everything else is rolled into the process total.
KEY_CATEGORIES = [
    "WebKit malloc",
    "IOSurface",
    "Owned physical footprint (unmapped) (graphics)",
    "IOAccelerator",
    "IOAccelerator (graphics)",
    "CoreAnimation",
    "JS VM Gigacage",
    "JS JIT generated code",
    "untagged (VM_ALLOCATE)",
    "MALLOC_SMALL",
    "MALLOC_LARGE",
    "MALLOC_TINY",
    "Accelerate image backing stores",
]
SHORT = {
    "WebKit malloc": "malloc",
    "IOSurface": "iosurf",
    "Owned physical footprint (unmapped) (graphics)": "gfx-unmapped",
    "IOAccelerator": "ioaccel",
    "IOAccelerator (graphics)": "ioaccel-gfx",
    "CoreAnimation": "coreanim",
    "JS VM Gigacage": "gigacage",
    "JS JIT generated code": "jit",
    "untagged (VM_ALLOCATE)": "vm_alloc",
    "MALLOC_SMALL": "m_small",
    "MALLOC_LARGE": "m_large",
    "MALLOC_TINY": "m_tiny",
    "Accelerate image backing stores": "accel-img",
}


# ---------------------------------------------------------------------------------------------
# Compaction of raw tool output (kept small: reports are committed as evidence)
# ---------------------------------------------------------------------------------------------


def _category_row(entry: dict) -> list[int]:
    return [entry.get(key, 0) for key in ("dirty", "swapped", "clean", "reclaimable", "wired", "regions")]


def _nonzero_categories(categories: dict) -> dict[str, list[int]]:
    result = {}
    for name, entry in (categories or {}).items():
        row = _category_row(entry)
        if any(row[:5]):
            result[name] = row
    return result


def compact_footprint(raw: dict, members: dict[int, str]) -> dict:
    """footprint -j, reduced to non-zero categories. Rows are [dirty, swapped, clean, reclaimable, wired, regions]."""
    processes = []
    by_role: dict[str, int] = {}
    for process in raw["processes"]:
        role = members.get(process["pid"], process["name"])
        by_role[role] = by_role.get(role, 0) + process["footprint"]
        processes.append({
            "pid": process["pid"], "role": role, "name": process["name"], "footprint": process["footprint"],
            "peak": (process.get("auxiliary") or {}).get("phys_footprint_peak"),
            "categories": _nonzero_categories(process.get("categories")),
        })
    shared = []
    for group in raw.get("shared") or []:
        categories = _nonzero_categories(group.get("categories"))
        if categories:
            shared.append({"pids": group.get("pids"), "specific": group.get("specific_to_pid"), "categories": categories})
    return {"total": raw["total footprint"], "byRole": by_role, "processes": processes, "shared": shared}


RUSAGE_KEYS = ("start_abstime", "cpu_ns", "pcpu_ns", "energy_nj", "interrupt_wakeups", "idle_wakeups", "instructions", "cycles", "phys_footprint")


def compact_rusage(value: dict | None) -> dict | None:
    """The rusage fields CPU/energy intervals need (the rest of the V6 struct is noise in a report)."""
    if not value:
        return value
    return {key: value[key] for key in RUSAGE_KEYS if key in value}


def compact_vmmap(summary: dict | None) -> dict | None:
    if not summary:
        return None
    regions = {name: row for name, row in (summary.get("regions") or {}).items() if row["virtual"] >= (1 << 20) or row["resident"] or row["swapped"]}
    return {"physicalFootprint": summary.get("physicalFootprint"), "regions": regions}


_VMMAP_V_ROW = re.compile(r"^(?P<name>\S.*?)\s+(?P<start>[0-9a-f]{6,})-(?P<end>[0-9a-f]{6,})\s+\[\s*(?P<vsize>[\d.]+[KMGT]?)\s+(?P<resident>[\d.]+[KMGT]?)\s+(?P<dirty>[\d.]+[KMGT]?)\s+(?P<swapped>[\d.]+[KMGT]?)\](?P<rest>.*)$")
_UNITS = {"": 1, "K": 1 << 10, "M": 1 << 20, "G": 1 << 30, "T": 1 << 40}


def _size(text: str) -> int:
    return round(float(text[:-1] if text[-1] in _UNITS else text) * _UNITS.get(text[-1] if text[-1] in _UNITS else "", 1))


def vmmap_iosurfaces(pid: int) -> dict | None:
    """IOSurface regions of a process from `vmmap -v`: count, bytes by state, size histogram."""
    try:
        result = subprocess.run(["vmmap", "-v", str(pid)], capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return None
    if result.returncode != 0:
        return None
    regions = []
    for line in result.stdout.splitlines():
        match = _VMMAP_V_ROW.match(line)
        if match and match["name"].strip() == "IOSurface":
            regions.append({
                "bytes": int(match["end"], 16) - int(match["start"], 16),
                "resident": _size(match["resident"]), "dirty": _size(match["dirty"]), "swapped": _size(match["swapped"]),
                "volatile": "PURGE=V" in match["rest"] or "purgeable" in match["rest"].lower(),
                "rest": match["rest"].strip()[:60],
            })
    histogram: dict[str, int] = {}
    for region in regions:
        key = f"{region['bytes'] / MIB:.2f}M"
        histogram[key] = histogram.get(key, 0) + 1
    return {
        "count": len(regions),
        "bytes": sum(r["bytes"] for r in regions),
        "resident": sum(r["resident"] for r in regions),
        "dirty": sum(r["dirty"] for r in regions),
        "volatile": sum(r["bytes"] for r in regions if r["volatile"]),
        "histogram": histogram,
        "sample": regions[:3],
    }


def _prune(value, depth: int):
    """Numbers, booleans and short strings of a diagnostics object, `depth` levels deep."""
    if isinstance(value, dict):
        if depth <= 0:
            return None
        out = {k: _prune(v, depth - 1) for k, v in value.items()}
        return {k: v for k, v in out.items() if v is not None}
    if isinstance(value, list):
        return [_prune(v, depth - 1) for v in value[:64]] if depth > 0 else None
    if isinstance(value, str):
        return value[:80]
    return value


def slim_event(event: dict) -> dict:
    """The page event without the per-session diagnostics detail (kept: counts and sizes)."""
    slim = dict(event)
    diag = dict(slim.get("diag") or {})
    sessions = []
    for session in diag.get("ghosttySessions") or []:
        sessions.append({
            "leafId": session.get("leafId"), "pty": session.get("pty"), "visible": session.get("visible"), "focused": session.get("focused"),
            "model": _prune(session.get("model"), 2), "surface": _prune(session.get("surface"), 2),
        })
    diag["ghosttySessions"] = sessions
    slim["diag"] = diag
    return slim


# ---------------------------------------------------------------------------------------------
# Qualification
# ---------------------------------------------------------------------------------------------


def qualify(scenario: str, phase: str, event: dict) -> list[str]:
    """Reasons this sample is not valid evidence for the phase it claims to measure."""
    if phase in ("blank", "setup", "done", "error"):
        return []
    native = event.get("native") or {}
    diag = event.get("diag") or {}
    reasons = []
    if scenario == "occlusion" and event.get("step") == "hidden":
        hide = event.get("hide") or {}
        if not hide.get("ok") or not hide.get("occluded"):
            reasons.append(f"window was not occluded by '{hide.get('mode')}'")
        if native.get("occlusionVisible"):
            reasons.append("AppKit still reports the window visible during the hold")
        if diag.get("visibility") != "hidden":
            reasons.append(f"document.visibilityState={diag.get('visibility')} during the hold")
        return reasons
    # `unfocused` scenarios move another application to the front on purpose (a window that stays
    # visible but is not key, like an app left behind another one); occlusion still disqualifies.
    unfocused = bool(event.get("unfocused"))
    if not native.get("appActive") and not unfocused:
        reasons.append("application is not active")
    if not native.get("key") and not unfocused:
        reasons.append("benchmark window is not key")
    if not native.get("occlusionVisible"):
        reasons.append("window is occluded")
    if diag.get("visibility") != "visible":
        reasons.append(f"document.visibilityState={diag.get('visibility')}")
    gpu = diag.get("ghosttyWebGpu") or {}
    if gpu and not gpu.get("windowFocused") and not unfocused:
        reasons.append("renderer reports the window unfocused")
    show = event.get("show")
    if show is not None and not show.get("ok"):
        reasons.append("window did not return to visible+key after show")
    return reasons


# ---------------------------------------------------------------------------------------------
# Sample accessors
# ---------------------------------------------------------------------------------------------


def usable(report: dict) -> dict:
    return {**report, "samples": [s for s in report["samples"] if "footprint" in s]}


def phase_of(sample: dict) -> str:
    return sample.get("phase") or sample["event"]["phase"]


def sample_by_phase(report: dict) -> dict[str, dict]:
    return {phase_of(s): s for s in report["samples"]}


def scenario_of(report: dict) -> str:
    return (report.get("config") or {}).get("scenario", "tabs")


def total_mib(sample: dict) -> float:
    return sample["footprintTotal"] / MIB


def role_mib(sample: dict, role: str) -> float:
    return sample["footprintByRole"].get(role, 0) / MIB


def categories_of(sample: dict, role: str) -> dict[str, dict[str, float]]:
    """Category -> {dirty, swapped, clean, reclaimable, wired, shared_*} in MiB for a role.

    `own` rows come from the process; rows from shared groups where the process is named in
    `specific_to_pid` are added (memory only that process holds in a shared group); group-wide
    shared rows are reported under shared_* and not added.
    """
    fp = sample["footprint"]
    result: dict[str, dict[str, float]] = {}
    pid = next((p["pid"] for p in fp["processes"] if p["role"] == role), None)
    if pid is None:
        return result

    def add(name: str, row: list[int], prefix: str = "") -> None:
        entry = result.setdefault(name, {})
        for key, value in zip(("dirty", "swapped", "clean", "reclaimable", "wired"), row[:5]):
            entry[prefix + key] = entry.get(prefix + key, 0.0) + value / MIB

    for process in fp["processes"]:
        if process["pid"] == pid:
            for name, row in process["categories"].items():
                add(name, row)
    for group in fp["shared"]:
        if pid not in (group.get("pids") or []):
            continue
        if group.get("specific") == pid:
            for name, row in group["categories"].items():
                add(name, row)
        elif group.get("specific") is None:
            for name, row in group["categories"].items():
                add(name, row, "shared_")
    return result


def category_dirty(sample: dict, role: str, name: str) -> float:
    return categories_of(sample, role).get(name, {}).get("dirty", 0.0)


def category_reclaimable(sample: dict, role: str, name: str) -> float:
    return categories_of(sample, role).get(name, {}).get("reclaimable", 0.0)


def vmmap_graphics(sample: dict, role: str) -> float | None:
    region = (((sample.get("vmmap") or {}).get(role) or {}).get("regions") or {}).get("owned unmapped (graphics)")
    if region is None:
        return None
    return max(region["resident"], region["dirty"] + region["swapped"]) / MIB


def roles_in(samples: list[dict]) -> list[str]:
    seen = {role for s in samples for role in s["footprintByRole"]}
    return [r for r in ROLES if r in seen] + sorted(seen - set(ROLES))


def diag_of(sample: dict) -> dict:
    return (sample["event"].get("diag") or {})


def pool_of(sample: dict) -> dict:
    return ((diag_of(sample).get("ghosttyWebGpu") or {}).get("canvases")) or {}


# ---------------------------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------------------------


def round_metrics(metrics: dict) -> dict:
    return {name: round(value, 4) if isinstance(value, float) else value for name, value in metrics.items()}


def _footprint_metrics(metrics: dict, name: str, sample: dict) -> None:
    metrics[f"footprint.{name}.total_mib"] = total_mib(sample)
    for role, value in sample["footprintByRole"].items():
        metrics[f"footprint.{name}.{role}_mib"] = value / MIB
    for role in ("web_content", "gpu", "host"):
        cats = categories_of(sample, role)
        for category in KEY_CATEGORIES[:3] + ["JS VM Gigacage", "untagged (VM_ALLOCATE)", "IOAccelerator (graphics)"]:
            entry = cats.get(category)
            if entry and (entry.get("dirty") or entry.get("reclaimable")):
                metrics[f"cat.{name}.{role}.{SHORT[category]}_mib"] = entry.get("dirty", 0.0)
                if entry.get("reclaimable"):
                    metrics[f"cat.{name}.{role}.{SHORT[category]}_reclaimable_mib"] = entry["reclaimable"]
        graphics = vmmap_graphics(sample, role)
        if graphics is not None:
            metrics[f"vmmap.{name}.{role}.owned_unmapped_gfx_mib"] = graphics


def _interval_metrics(metrics: dict, prefix: str, value: dict | None) -> None:
    if not value:
        return
    metrics[f"{prefix}.seconds"] = value["seconds"]
    for role, pct in sorted(value["cpu_pct"].items()):
        metrics[f"{prefix}.cpu_pct.{role}"] = pct
    metrics[f"{prefix}.cpu_pct.total"] = value["cpu_pct_total"]
    app_only = sum(pct for role, pct in value["cpu_pct"].items() if role != "workload")
    metrics[f"{prefix}.cpu_pct.app_total"] = app_only
    if value.get("window_server_cpu_pct") is not None:
        metrics[f"{prefix}.cpu_pct.window_server"] = value["window_server_cpu_pct"]
    for role, joules in sorted(value["energy_j_per_min"].items()):
        metrics[f"{prefix}.energy_j_per_min.{role}"] = joules
    if value.get("energy_j_per_min_total") is not None:
        metrics[f"{prefix}.energy_j_per_min.total"] = value["energy_j_per_min_total"]
        metrics[f"{prefix}.power_mw.total"] = value["power_mw_total"]
    for role, wakeups in sorted(value["wakeups_per_s"].items()):
        metrics[f"{prefix}.wakeups_per_s.{role}"] = wakeups
    metrics[f"{prefix}.wakeups_per_s.total"] = value["wakeups_per_s_total"]
    if value.get("instructions"):
        metrics[f"{prefix}.instructions_g_per_s"] = value["instructions"] / value["seconds"] / 1e9
        metrics[f"{prefix}.cycles_g_per_s"] = value["cycles"] / value["seconds"] / 1e9


def _series_metrics(metrics: dict, name: str, samples: list[tuple[int, dict]], base: dict | None) -> None:
    """Growth of the total, the per-role footprint and the key categories over cycles."""
    if not samples:
        return
    xs = [c for c, _ in samples]
    totals = [total_mib(s) for _, s in samples]
    metrics[f"{name}.max_mib"] = max(totals)
    metrics[f"{name}.mean_mib"] = statistics.fmean(totals)
    fit = slope(xs, totals)
    if fit is not None:
        metrics[f"{name}.growth_mib_per_cycle"] = fit
    if base:
        metrics[f"{name}.growth_first_to_last_mib"] = totals[-1] - total_mib(base)
        for role in roles_in([base] + [s for _, s in samples]):
            metrics[f"{name}.growth.{role}_mib"] = role_mib(samples[-1][1], role) - role_mib(base, role)
        for role in ("web_content", "gpu", "host"):
            for category in ("WebKit malloc", "IOSurface", "untagged (VM_ALLOCATE)", "IOAccelerator (graphics)"):
                last = category_dirty(samples[-1][1], role, category) - category_dirty(base, role, category)
                if abs(last) >= 0.05:
                    metrics[f"{name}.growth.{role}.{SHORT[category]}_mib"] = last
            last = category_reclaimable(samples[-1][1], role, "IOSurface") - category_reclaimable(base, role, "IOSurface")
            if abs(last) >= 0.05:
                metrics[f"{name}.growth.{role}.iosurf_reclaimable_mib"] = last
    for role in roles_in([s for _, s in samples]):
        fit = slope(xs, [role_mib(s, role) for _, s in samples])
        if fit is not None:
            metrics[f"{name}.growth_mib_per_cycle.{role}"] = fit
    for role in ("web_content", "gpu", "host"):
        for category in ("WebKit malloc", "IOSurface", "untagged (VM_ALLOCATE)"):
            fit = slope(xs, [category_dirty(s, role, category) for _, s in samples])
            if fit is not None and abs(fit) >= 0.005:
                metrics[f"{name}.growth_mib_per_cycle.{role}.{SHORT[category]}"] = fit
        fit = slope(xs, [category_reclaimable(s, role, "IOSurface") for _, s in samples])
        if fit is not None and abs(fit) >= 0.005:
            metrics[f"{name}.growth_mib_per_cycle.{role}.iosurf_reclaimable"] = fit


def _event_samples(report: dict, step: str) -> list[tuple[int, dict]]:
    found = [(s["event"]["cycle"], s) for s in report["samples"] if s["event"].get("step") == step and "cycle" in s["event"]]
    return sorted(found, key=lambda pair: pair[0])


def _series_by_role(report: dict) -> list[tuple[float, dict[str, float]]]:
    """[(wall time, role -> phys_footprint MiB)] from the cheap timeline."""
    result = []
    for entry in report.get("series") or []:
        roles: dict[str, float] = {}
        for value in entry["processes"].values():
            if value["role"] in ROLES:
                roles[value["role"]] = roles.get(value["role"], 0.0) + value["phys_footprint"] / MIB
        if roles:
            roles["total"] = sum(v for k, v in roles.items() if k != "total")
            result.append((entry["tWall"], roles))
    return result


def timeline_windows(report: dict) -> list[tuple[int, float, float]]:
    """(cycle, start, end) wall-clock windows, one per switch/cycle/drag, from the page events."""
    scenario = scenario_of(report)
    windows = []
    previous = None
    for sample in report["samples"]:
        event = sample["event"]
        end = sample["tWall"] if "tWall" in sample else event.get("tWall", 0) / 1000
        if "cycle" in event and event.get("cycle", 0) > 0 and (
            scenario != "occlusion" or event.get("step") == "visible"
        ):
            start = event.get("switchedAt", None)
            start = start / 1000 if start else (previous if previous is not None else end - 5)
            windows.append((event["cycle"], start, end))
        previous = end
    return windows


def _timeline_metrics(metrics: dict, report: dict) -> None:
    series = _series_by_role(report)
    windows = timeline_windows(report)
    if not series or not windows:
        return
    for role in ("total", "web_content", "gpu", "host"):
        floors, peaks, lasts = [], [], []
        for cycle, start, end in windows:
            values = [roles[role] for t, roles in series if start <= t <= end and role in roles]
            if values:
                floors.append((cycle, min(values)))
                peaks.append((cycle, max(values)))
                lasts.append((cycle, values[-1]))
        if len(floors) >= 2:
            for name, group in (("floor", floors), ("peak", peaks), ("last", lasts)):
                fit = slope([c for c, _ in group], [v for _, v in group])
                if fit is not None:
                    metrics[f"timeline.{name}_growth_mib_per_cycle.{role}"] = fit
                metrics[f"timeline.{name}.first.{role}_mib"] = group[0][1]
                metrics[f"timeline.{name}.last.{role}_mib"] = group[-1][1]
                metrics[f"timeline.{name}.max.{role}_mib"] = max(v for _, v in group)
    values = [roles["total"] for _, roles in series]
    metrics["timeline.total.max_mib"] = max(values)
    metrics["timeline.total.min_mib"] = min(values)
    metrics["timeline.samples"] = len(series)


def _counter_metrics(metrics: dict, by_phase: dict, samples: list[dict]) -> None:
    """Per-cycle rates of the optional WebGPU/DOM lifecycle counters (--instrument)."""
    base = by_phase.get("baseline")
    cycles = [s for s in samples if "cycle" in s["event"] and s["event"]["cycle"] > 0]
    if not base or not cycles:
        return
    first = diag_of(base).get("counters")
    last = diag_of(cycles[-1]).get("counters")
    count = cycles[-1]["event"]["cycle"]
    if not first or not last or not count:
        return
    for key, value in last.items():
        if key == "instrumented" or not isinstance(value, (int, float)):
            continue
        delta = value - first.get(key, 0)
        metrics[f"counters.{key}_per_cycle"] = delta / count
    # IPC: report the busiest commands by calls per cycle.
    ipc = {k: v for k, v in last.items() if k.startswith("ipc.") and k != "ipc.bytes"}
    for key in sorted(ipc, key=lambda k: -(ipc[k] - first.get(k, 0)))[:12]:
        metrics[f"ipc.{key[4:]}_per_cycle"] = (ipc[key] - first.get(key, 0)) / count
    for kind in {k.rsplit(".", 1)[0] for k in last if k.endswith(".created")}:
        created, finalized = last.get(f"{kind}.created", 0), last.get(f"{kind}.finalized", 0)
        metrics[f"counters.{kind}.alive"] = created - finalized


SMOOTH_FIELDS = [
    ("fps", "fps", None),
    ("frameIntervalMs", "frame_interval_p95_ms", "p95"),
    ("busyIntervalMs", "busy_interval_p50_ms", "p50"),
    ("busyIntervalMs", "busy_interval_p95_ms", "p95"),
    ("busyIntervalMs", "busy_interval_max_ms", "max"),
    ("rafIntervalMs", "raf_interval_p95_ms", "p95"),
    ("refreshMs", "refresh_ms", None),
    ("frameCostMs", "frame_cost_p95_ms", "p95"),
    ("frameCostMs", "frame_cost_max_ms", "max"),
    ("contentAgeMs", "content_age_p50_ms", "p50"),
    ("contentAgeMs", "content_age_p95_ms", "p95"),
    ("contentAgeMs", "content_age_max_ms", "max"),
    ("reflowIntervalMs", "reflow_interval_p50_ms", "p50"),
    ("reflowIntervalMs", "reflow_interval_p95_ms", "p95"),
    ("reflowIntervalMs", "reflow_interval_max_ms", "max"),
    ("rectLagMs", "rect_lag_p95_ms", "p95"),
    ("rectLagMs", "rect_lag_max_ms", "max"),
    ("gridStalenessMs", "staleness_p50_ms", "p50"),
    ("gridStalenessMs", "staleness_p95_ms", "p95"),
    ("gridStalenessMs", "staleness_max_ms", "max"),
    ("staleShare", "stale_share", None),
    ("gridResizesPerS", "grid_resizes_per_s", None),
    ("settleMs", "settle_ms", None),
    ("gridResizesMaxPane", "sigwinch_per_pane_max", None),
    ("cursorClipped", "cursor_clipped_frames", None),
    ("cursorFrames", "cursor_frames", None),
    ("resizeCostMs", "resize_cost_p95_ms", "p95"),
    ("frozenMs", "frozen_ms", None),
    ("frozenMaxMs", "frozen_max_ms", None),
    ("frozenOverFrame", "frozen_over_frame", None),
    ("frozenShare", "frozen_share", None),
    ("blankFrames", "blank_frames", None),
    ("erasedPrompts", "erased_prompts", None),
    ("redrawMs", "redraw_p50_ms", "p50"),
    ("redrawMs", "redraw_p95_ms", "p95"),
    ("slowFrames", "slow_frames", None),
    ("stalledFrames", "stalled_frames", None),
    ("frames", "frames", None),
]


def _smooth_metrics(metrics: dict, steps: list[dict]) -> None:
    """Per-gesture smoothness (page-side probe), reduced over the gestures: median and worst."""
    smooths = [s["event"]["smooth"] for s in steps if isinstance((s.get("event") or {}).get("smooth"), dict)]
    if not smooths:
        return
    metrics["smooth.gestures"] = len(smooths)
    for field, name, sub in SMOOTH_FIELDS:
        values = []
        for smooth in smooths:
            value = smooth.get(field)
            if sub is not None and isinstance(value, dict):
                value = value.get(sub)
            if isinstance(value, (int, float)):
                values.append(float(value))
        if values:
            metrics[f"smooth.{name}.median"] = statistics.median(values)
            metrics[f"smooth.{name}.worst"] = max(values) if name not in ("fps", "frames") else min(values)
    reallocs = [r for smooth in smooths for r in smooth.get("reallocs") or []]
    metrics["smooth.reallocs"] = len(reallocs)
    if reallocs:
        metrics["smooth.realloc_cost_max_ms"] = max(r["costMs"] for r in reallocs)


def compute_metrics(report: dict) -> dict[str, float]:
    full = report
    report = usable(report)
    scenario = scenario_of(report)
    samples = report["samples"]
    by_phase = sample_by_phase(report)
    metrics: dict[str, float] = {}
    for sample in samples:
        phase = phase_of(sample)
        if phase in ("setup", "baseline", "cycles-complete", "end+10s", "end+30s", "post-gc+2s", "post-gc+10s", "resize-settled", "measure-start", "measure-end", "setup-complete"):
            _footprint_metrics(metrics, phase, sample)
    last_event = samples[-1]["event"] if samples else {}
    diag = last_event.get("diag") or {}
    pool = (diag.get("ghosttyWebGpu") or {}).get("canvases") or {}
    for key in ("created", "reused", "reconfigured", "destroyed", "idle", "leased", "parked", "backingStoreResizes", "windowFrames"):
        if key in pool and isinstance(pool[key], (int, float)):
            metrics[f"pool.{key}"] = pool[key]
    mirror = (diag.get("ghosttyWebGpu") or {}).get("gcMirror") or {}
    for key in ("frames", "allocations", "allocatedBytes"):
        if key in mirror:
            metrics[f"gc_mirror.{key}"] = mirror[key]
    metrics["dom.max_canvases"] = max((diag_of(s).get("dom") or {}).get("canvases", 0) for s in samples)
    core = diag.get("ghosttyCore") or {}
    if core:
        metrics["wasm.instances"] = core.get("wasmInstanceCount", 0)
        metrics["wasm.memory_mib"] = core.get("wasmMemoryBytes", 0) / MIB
    metrics["wasm.max_memory_mib"] = max(((diag_of(s).get("ghosttyCore") or {}).get("wasmMemoryBytes", 0) / MIB for s in samples), default=0)
    metrics["dom.elements"] = (diag.get("dom") or {}).get("elements", 0)
    _timeline_metrics(metrics, full)
    _counter_metrics(metrics, by_phase, samples)

    if scenario in ("tabs", "occlusion", "resize", "split-drag"):
        base = by_phase.get("baseline")
        if scenario == "tabs":
            switches = sorted(
                ((s["event"]["cycle"], s) for s in samples if phase_of(s).startswith("switch-")),
                key=lambda pair: pair[0],
            )
            _series_metrics(metrics, "tabs.switch", switches, base)
            # Tab roles: odd switches land on the agent tab, even ones on the shell tab.
            order = (by_phase.get("setup", {}).get("event") or {}).get("order") or []
            if order and len(order) <= 2:
                for parity, label in ((1, "agent"), (0, "shell")):
                    group = [(c, s) for c, s in switches if c % 2 == parity]
                    if group:
                        metrics[f"tabs.on_{label}.mean_mib"] = statistics.fmean(total_mib(s) for _, s in group)
            visible = switches
        elif scenario == "occlusion":
            visible = _event_samples(report, "visible")
            hidden = _event_samples(report, "hidden")
            _series_metrics(metrics, "occlusion.visible", visible, base)
            if hidden:
                totals = [total_mib(s) for _, s in hidden]
                metrics["occlusion.hidden.max_mib"] = max(totals)
                metrics["occlusion.hidden.mean_mib"] = statistics.fmean(totals)
            per = {}
            for cycle, s in hidden:
                hide = s["event"].get("hide") or {}
                per[cycle] = bool(hide.get("ok") and hide.get("occluded"))
            metrics["cycles.occluded"] = sum(per.values())
        else:
            steps = [s for s in samples if phase_of(s).split("-")[0] in ("shrink", "grow", "drag")]
            visible = [(i + 1, s) for i, s in enumerate(steps)]
            _series_metrics(metrics, "resize.drags", visible, base)
            for sample in steps:
                metrics[f"footprint.{phase_of(sample)}.total_mib"] = total_mib(sample)
            if steps:
                metrics["resize.peak_total_mib"] = max(total_mib(s) for s in steps)
                metrics["resize.peak_web_content_mib"] = max(role_mib(s, "web_content") for s in steps)
                metrics["resize.peak_over_baseline_mib"] = metrics["resize.peak_total_mib"] - (total_mib(base) if base else 0)
            window = [(by_phase.get("baseline"), steps[-1])] if base and steps else []
            for start, end in window:
                _interval_metrics(metrics, "resize.drag", interval(start, end))
            _smooth_metrics(metrics, steps)
        if "end+30s" in by_phase and "post-gc+10s" in by_phase:
            metrics["footprint.gc_recovered_mib"] = total_mib(by_phase["end+30s"]) - total_mib(by_phase["post-gc+10s"])
            metrics["footprint.gc_recovered.web_content_mib"] = role_mib(by_phase["end+30s"], "web_content") - role_mib(by_phase["post-gc+10s"], "web_content")
            metrics["footprint.gc_recovered.web_content.malloc_mib"] = category_dirty(by_phase["end+30s"], "web_content", "WebKit malloc") - category_dirty(by_phase["post-gc+10s"], "web_content", "WebKit malloc")
        if base and "end+30s" in by_phase:
            metrics["footprint.settle_delta_vs_baseline_mib"] = total_mib(by_phase["end+30s"]) - total_mib(base)
            for role in roles_in(samples):
                metrics[f"footprint.settle_delta.{role}_mib"] = role_mib(by_phase["end+30s"], role) - role_mib(base, role)
        if base and visible:
            metrics["footprint.max_after_baseline_mib"] = max(total_mib(s) for _, s in visible) - total_mib(base)
        # CPU/energy over the loop and over the idle tail.
        if base and visible:
            _interval_metrics(metrics, "loop", interval(base, visible[-1][1]))
        if "cycles-complete" in by_phase and "end+30s" in by_phase:
            _interval_metrics(metrics, "tail", interval(by_phase["cycles-complete"], by_phase["end+30s"]))
        return metrics

    # agents-steady / idle
    start, end = by_phase.get("measure-start"), by_phase.get("measure-end")
    if not start or not end:
        return metrics
    metrics["footprint.delta_mib"] = total_mib(end) - total_mib(start)
    window = interval(start, end)
    _interval_metrics(metrics, "window", window)
    seconds = window["seconds"] if window else (end["tMonoNs"] - start["tMonoNs"]) / 1e9
    counters_a, counters_b = diag_of(start).get("counters"), diag_of(end).get("counters")
    if counters_a and counters_b and seconds:
        for key, value in counters_b.items():
            if key != "instrumented" and isinstance(value, (int, float)) and value - counters_a.get(key, 0):
                metrics[f"counters.{key}_per_s"] = (value - counters_a.get(key, 0)) / seconds
    metrics["page.css_animations"] = diag_of(end).get("animations") or 0
    gpu_a, gpu_b = diag_of(start).get("ghosttyWebGpu") or {}, diag_of(end).get("ghosttyWebGpu") or {}
    if gpu_a and gpu_b:
        metrics["renderer.gpu_submissions_per_s"] = (gpu_b["submittedFrames"] - gpu_a["submittedFrames"]) / seconds
        for key, name in (("animationFrames", "animation_frames"), ("idleAnimationFrames", "idle_animation_frames"), ("timerWakeups", "timer_wakeups"), ("workDoneWaits", "work_done_waits")):
            if key in gpu_a and key in gpu_b:
                metrics[f"renderer.{name}_per_s"] = (gpu_b[key] - gpu_a[key]) / seconds
    transport_a, transport_b = diag_of(start).get("ptyTransport") or {}, diag_of(end).get("ptyTransport") or {}
    hub_a, hub_b = transport_a.get("hub") or {}, transport_b.get("hub") or {}
    for key in ("polls", "bytes", "frames"):
        if isinstance(hub_a.get(key), (int, float)) and isinstance(hub_b.get(key), (int, float)):
            metrics[f"pty.hub_{key}_per_s"] = (hub_b[key] - hub_a[key]) / seconds
    return metrics


# ---------------------------------------------------------------------------------------------
# Human summary
# ---------------------------------------------------------------------------------------------


def _m(value: float | None, digits: int = 1) -> str:
    return "-" if value is None else f"{value:,.{digits}f}"


def _pairs_table(samples: list[dict], base: dict | None, name_of) -> str:
    roles = roles_in(samples)
    headers = ["phase"] + [ROLE_LABELS.get(r, r) for r in roles] + ["TOTAL", "delta", "WC malloc", "WC iosurf", "WC iosurf recl", "GPU iosurf", "GPU iosurf recl", "gfx WC/GPU", "pool"]
    rows, previous = [], base
    for sample in samples:
        pool = pool_of(sample)
        total = total_mib(sample)
        gfx_wc, gfx_gpu = vmmap_graphics(sample, "web_content"), vmmap_graphics(sample, "gpu")
        rows.append(
            [name_of(sample)]
            + [_m(role_mib(sample, r)) for r in roles]
            + [_m(total), "" if previous is None else f"{total - total_mib(previous):+.1f}"]
            + [
                _m(category_dirty(sample, "web_content", "WebKit malloc")),
                _m(category_dirty(sample, "web_content", "IOSurface")),
                _m(category_reclaimable(sample, "web_content", "IOSurface")),
                _m(category_dirty(sample, "gpu", "IOSurface")),
                _m(category_reclaimable(sample, "gpu", "IOSurface")),
                "-" if gfx_wc is None and gfx_gpu is None else f"{gfx_wc or 0:.0f}/{gfx_gpu or 0:.0f}",
                f"{pool.get('created', '-')}c/{pool.get('reused', '-')}r/{pool.get('destroyed', '-')}d" if pool else "-",
            ]
        )
        previous = sample
    return table(headers, rows)


def _interval_table(pairs: list[tuple[str, dict | None]], roles: list[str]) -> str:
    return lab_report._interval_table(pairs, roles)


def smooth_table(steps: list[dict]) -> str:
    head = ["gesture", "fps", "int p50", "p95", "max", "raf p95", "lag p95", "lag max", "age p50", "p95", "max", "reflow p50", "p95", "max", "stale%", "settle", "resz/pane", "crsr clip/n", "frozen ms", "max", ">1fr", "frz%", "blank", "erased", "redraw p50", "p95", "cost p95", "reallocs"]
    rows = [head]
    for sample in steps:
        smooth = (sample.get("event") or {}).get("smooth")
        if not isinstance(smooth, dict):
            continue
        f = lambda key, sub: (smooth.get(key) or {}).get(sub, 0)
        rows.append([
            phase_of(sample), f"{smooth['fps']:.1f}", f"{f('busyIntervalMs', 'p50'):.1f}", f"{f('busyIntervalMs', 'p95'):.1f}", f"{f('busyIntervalMs', 'max'):.1f}",
            f"{f('rafIntervalMs', 'p95'):.1f}", f"{f('rectLagMs', 'p95'):.1f}", f"{f('rectLagMs', 'max'):.1f}",
            f"{f('contentAgeMs', 'p50'):.0f}", f"{f('contentAgeMs', 'p95'):.0f}", f"{f('contentAgeMs', 'max'):.0f}", f"{f('reflowIntervalMs', 'p50'):.0f}", f"{f('reflowIntervalMs', 'p95'):.0f}", f"{f('reflowIntervalMs', 'max'):.0f}", f"{smooth['staleShare'] * 100:.0f}",
            str(smooth.get("settleMs", "-")), str(smooth.get("gridResizesMaxPane", "-")), f"{smooth.get('cursorClipped', 0)}/{smooth.get('cursorFrames', 0)}", str(smooth["frozenMs"]), str(smooth["frozenMaxMs"]), str(smooth["frozenOverFrame"]), f"{smooth['frozenShare'] * 100:.0f}",
            str(smooth["blankFrames"]), str(smooth["erasedPrompts"]), f"{f('redrawMs', 'p50'):.0f}", f"{f('redrawMs', 'p95'):.0f}", f"{f('frameCostMs', 'p95'):.1f}",
            ",".join(f"{r['costMs']:.0f}ms@{r['width']}x{r['height']}" for r in smooth.get("reallocs") or []) or "-",
        ])
    widths = [max(len(r[i]) for r in rows) for i in range(len(head))]
    return "\n".join("  " + "  ".join(c.rjust(w) for c, w in zip(r, widths)) for r in rows)


def summarize(report: dict) -> str:
    report = usable(report)
    scenario = scenario_of(report)
    samples = report["samples"]
    config = report.get("config") or {}
    scn = config.get("scenarioJson") or {}
    by_phase = sample_by_phase(report)
    metrics = compute_metrics(report)
    roles = roles_in(samples)
    out = [f"== app lab: {scenario}{('/' + scn['variant']) if scn.get('variant') else ''} ==" + (f" [{config.get('label')}]" if config.get("label") else "")]
    out.append(f"  source {str(report.get('sourceRevision'))[:12]}  profile {config.get('profile')}  qualified: {report.get('qualification', {}).get('qualified', 'n/a')}")
    out.append("  " + ", ".join(f"{k} {v}" for k, v in scn.items() if k not in ("localStorage", "name", "variant", "window", "live")) + f"; window {scn.get('window')}")
    if scn.get("localStorage"):
        out.append(f"  localStorage: {scn['localStorage']}")
    base = by_phase.get("baseline")
    if scenario in ("tabs", "occlusion", "resize", "split-drag"):
        rows_samples = []
        if base:
            rows_samples.append(base)
        if scenario == "tabs":
            body = [s for s in samples if phase_of(s).startswith("switch-")]
        elif scenario == "occlusion":
            body = [s for s in samples if phase_of(s).startswith("cycle-")]
        else:
            body = [s for s in samples if phase_of(s).split("-")[0] in ("shrink", "grow", "drag")]
        # Long runs: every row for the first 3 and last 3, then every 5th.
        shown = [s for i, s in enumerate(body) if i < 3 or i >= len(body) - 3 or (i + 1) % 5 == 0]
        tail = [by_phase[n] for n in ("cycles-complete", "resize-settled", "end+10s", "end+30s", "post-gc+2s", "post-gc+10s") if n in by_phase]
        out.append("\nFootprint (MiB). WC = WebContent; malloc = 'WebKit malloc' dirty (incl. compressed); iosurf = IOSurface dirty;")
        out.append("recl = IOSurface reclaimable (volatile, not in the footprint total); gfx = vmmap 'owned unmapped (graphics)'; pool = WebGPU canvases created/reused/destroyed:")
        out.append(_pairs_table(rows_samples + shown + tail, None, phase_of))
        if scenario == "tabs":
            out.append("\nGrowth per switch (MiB/switch, least squares): " + ", ".join(
                f"{k.split('.growth_mib_per_cycle.')[1] if '.growth_mib_per_cycle.' in k else 'total'} {v:+.3f}"
                for k, v in metrics.items() if k.startswith("tabs.switch.growth_mib_per_cycle")))
            if "tabs.switch.growth_first_to_last_mib" in metrics:
                out.append(f"Baseline -> last switch: {metrics['tabs.switch.growth_first_to_last_mib']:+.1f} MiB; after +30 s idle vs baseline: {metrics.get('footprint.settle_delta_vs_baseline_mib', float('nan')):+.1f} MiB")
        pairs = []
        for name in ("loop", "tail", "resize.drag"):
            seconds = metrics.get(f"{name}.seconds")
            if seconds is not None:
                pairs.append((name, _metrics_interval(metrics, name, roles)))
        if pairs:
            out.append("\nCPU% (of one core) and energy:")
            out.append(_interval_table(pairs, roles + (["workload"] if any("workload" in (p[1] or {}).get("cpu_pct", {}) for p in pairs) else [])))
        if scenario in ("resize", "split-drag"):
            out.append("\nSmoothness per gesture (page-side probe):")
            out.append(smooth_table([s for s in samples if phase_of(s).split("-")[0] in ("shrink", "grow", "drag")]))
    else:
        rows_samples = [s for s in samples if phase_of(s) in ("setup-complete", "measure-start", "measure-end")]
        out.append("\nFootprint (MiB):")
        out.append(_pairs_table(rows_samples, None, phase_of))
        window = _metrics_interval(metrics, "window", roles)
        out.append("\nCPU% (of one core) and energy over the measured window:")
        out.append(_interval_table([("measured window", window)], roles + (["workload"] if window and "workload" in window["cpu_pct"] else [])))
        for key in ("window.power_mw.total", "window.wakeups_per_s.total", "window.instructions_g_per_s", "renderer.gpu_submissions_per_s", "renderer.animation_frames_per_s", "renderer.idle_animation_frames_per_s", "renderer.timer_wakeups_per_s", "renderer.work_done_waits_per_s"):
            if key in metrics:
                out.append(f"  {key}: {metrics[key]:.2f}")
    out.append(f"\n  WASM: {metrics.get('wasm.instances', '-')} instances, {metrics.get('wasm.memory_mib', 0):.1f} MiB linear memory (peak {metrics.get('wasm.max_memory_mib', 0):.1f}); DOM elements {metrics.get('dom.elements', '-')}")
    qualification = report.get("qualification") or {}
    for advisory in qualification.get("advisories") or []:
        out.append(f"\nADVISORY: {advisory}")
    if qualification.get("failures"):
        out.append("\nQUALIFICATION FAILURES (results are not valid evidence):")
        for failure in qualification["failures"][:12]:
            out.append(f"  - {failure['phase']}: {'; '.join(failure['reasons'])}")
    out.append(f"\n  host {report.get('environment', {}).get('chip', '?')}; load average at start {report.get('environment', {}).get('loadAverageStart')}; end {report.get('environment', {}).get('loadAverageEnd')}")
    out.append(f"  scope: {report.get('scope')}")
    return "\n".join(out)


def _metrics_interval(metrics: dict, prefix: str, roles: list[str]) -> dict | None:
    seconds = metrics.get(f"{prefix}.seconds")
    if seconds is None:
        return None
    present = [r for r in roles + ["workload"] if f"{prefix}.cpu_pct.{r}" in metrics]
    return {
        "seconds": seconds,
        "cpu_pct": {r: metrics[f"{prefix}.cpu_pct.{r}"] for r in present},
        "cpu_pct_total": metrics.get(f"{prefix}.cpu_pct.app_total", metrics.get(f"{prefix}.cpu_pct.total", 0)),
        "window_server_cpu_pct": metrics.get(f"{prefix}.cpu_pct.window_server"),
        "energy_j_per_min": {r: metrics[f"{prefix}.energy_j_per_min.{r}"] for r in present if f"{prefix}.energy_j_per_min.{r}" in metrics},
        "energy_j_per_min_total": metrics.get(f"{prefix}.energy_j_per_min.total"),
    }


# ---------------------------------------------------------------------------------------------
# Comparison / IO
# ---------------------------------------------------------------------------------------------


def compare(baseline, candidate) -> str:
    baselines = baseline if isinstance(baseline, list) else [baseline]
    candidates = candidate if isinstance(candidate, list) else [candidate]
    base_metrics, cand_metrics = _median(baselines), _median(candidates)
    names = list(base_metrics) + [n for n in cand_metrics if n not in base_metrics]
    first, second = baselines[0], candidates[0]
    lines = [f"== comparison: {scenario_of(first)} (baseline {str(first.get('sourceRevision'))[:10]} x{len(baselines)} -> candidate {str(second.get('sourceRevision'))[:10]} x{len(candidates)}; medians when repeated) =="]
    if scenario_of(first) != scenario_of(second):
        lines.append("  warning: scenarios differ; matching metric names only")
    for key in ("scenarioJson",):
        a, b = (first.get("config") or {}).get(key), (second.get("config") or {}).get(key)
        if a != b:
            lines.append("  warning: scenario configuration differs (including localStorage toggles)")
    rows = []
    for name in names:
        a, b = base_metrics.get(name), cand_metrics.get(name)
        if a is None and b is None:
            continue
        delta = None if a is None or b is None else b - a
        percent = "" if delta is None or not a else f"{100 * delta / abs(a):+.1f}%"
        rows.append([name, _fmt(a), _fmt(b), "-" if delta is None else f"{delta:+,.2f}", percent])
    lines.append(table(["metric", "baseline", "candidate", "delta", "%"], rows))
    return "\n".join(lines)


def _fmt(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:,.2f}" if abs(value) < 100000 else f"{value:,.0f}"


def _median(reports: list[dict]) -> dict[str, float]:
    per_report = [compute_metrics(r) for r in reports]
    names = [n for n in per_report[0] if all(n in other for other in per_report)]
    return {n: statistics.median(m[n] for m in per_report) for n in names}


def median_metrics(reports: list[dict]) -> dict[str, float]:
    return _median(reports)


load = lab_report.load
dump = lab_report.dump


def write_json(path: Path, value) -> None:
    Path(path).write_text(json.dumps(value, indent=1) + "\n")


def experiment_row(report: dict) -> list[str]:
    """One comparable line per report: where WebContent starts, ends, and what a forced GC returns."""
    samples = report["samples"]
    by_phase = {phase_of(s): s for s in samples}

    def wc(phase: str) -> float | None:
        sample = by_phase.get(phase)
        return None if sample is None else role_mib(sample, "web_content")

    def malloc(phase: str) -> float | None:
        sample = by_phase.get(phase)
        return category_dirty(sample, "web_content", "WebKit malloc") if sample and "footprint" in sample else None

    def iosurface(phase: str) -> float | None:
        sample = by_phase.get(phase)
        return category_dirty(sample, "web_content", "IOSurface") if sample and "footprint" in sample else None

    cycles = max((s["event"].get("cycle", 0) for s in samples), default=0)
    start, end, collected = wc("baseline"), wc("end+30s"), wc("post-gc+10s")
    metrics = report.get("metrics") or compute_metrics(report)
    resizes = None
    last = next((s for s in reversed(samples) if "cycle" in s["event"] and s["event"]["cycle"] > 0), None)
    if last:
        resizes = sum((x["surface"] or {}).get("backingStoreResizes", 0) for x in diag_of(last).get("ghosttySessions") or [])
        # One shared window canvas: the runtime counts its swapchain allocations (including the first).
        window = pool_of(last).get("backingStoreResizes")
        if window is not None:
            resizes = window

    def f(value, signed=False):
        return "-" if value is None else (f"{value:+.0f}" if signed else f"{value:.0f}")

    return [
        (report.get("config") or {}).get("label") or "",
        str(cycles),
        f(start), f(end), f(end - start if start is not None and end is not None else None, True),
        f(collected), f(collected - start if start is not None and collected is not None else None, True),
        f(malloc("baseline")), f(malloc("end+30s")), f(iosurface("baseline")), f(iosurface("end+30s")),
        "-" if resizes is None else str(resizes),
        f"{metrics.get('timeline.floor_growth_mib_per_cycle.web_content', float('nan')):+.2f}",
    ]


EXPERIMENT_HEADERS = ["run", "cycles", "WC start", "WC +30s", "delta", "WC after GC", "delta", "malloc 0", "malloc +30s", "iosurf 0", "iosurf +30s", "resizes", "floor MiB/cycle"]


if __name__ == "__main__":
    paths = [Path(p) for p in sys.argv[1:]]
    if not paths:
        raise SystemExit("usage: app_report.py REPORT.json [...]  (one comparable line per report; WebContent MiB)")
    rows = []
    for path in paths:
        row = experiment_row(load(path))
        row[0] = f"{path.stem.removeprefix('app-')}: {row[0]}"[:90]
        rows.append(row)
    print(table(EXPERIMENT_HEADERS, rows))
