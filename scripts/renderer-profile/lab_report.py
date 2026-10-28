"""Metrics, human summaries and baseline comparison for renderer lab reports.

Everything here is derived from the raw samples stored in a report, so a report written by an
older lab revision (footprint samples only) can still be compared where metrics overlap.
"""

import json
import math
from pathlib import Path

from procstats import ROLE_LABEL, ROLE_ORDER

MIB = 1048576.0


# ---------------------------------------------------------------------------------------------
# Sample accessors
# ---------------------------------------------------------------------------------------------

def phase_of(sample: dict) -> str:
    return sample.get("phase") or sample["event"]["phase"]


def usable(report: dict) -> dict:
    """Drop bookkeeping samples (e.g. the final 'done' event) that carry no measurements."""
    return {**report, "samples": [s for s in report["samples"] if "footprint" in s]}


def workload_of(report: dict) -> str:
    return (report.get("config") or {}).get("workload", "default")


def total_bytes(sample: dict) -> int:
    return sample.get("footprintTotal", sample["footprint"]["total footprint"])


def footprint_by_role(sample: dict) -> dict[str, int]:
    if "footprintByRole" in sample:
        return sample["footprintByRole"]
    # Legacy samples: roles come from the footprint process names.
    names = {
        "renderer-lab": "host",
        "com.apple.WebKit.WebContent": "web_content",
        "com.apple.WebKit.GPU": "gpu",
        "com.apple.WebKit.Networking": "networking",
    }
    result: dict[str, int] = {}
    for process in sample["footprint"]["processes"]:
        role = names.get(process["name"], process["name"])
        result[role] = result.get(role, 0) + process["footprint"]
    return result


def graphics_mib(sample: dict, role: str) -> float | None:
    """Graphics memory a process owns without mapping it (IOSurface/canvas backing), from vmmap."""
    summary = (sample.get("vmmap") or {}).get(role)
    row = ((summary or {}).get("regions") or {}).get("owned unmapped (graphics)")
    if row is None:
        return None
    # Pages compressed or swapped out still count toward physical footprint, so a process whose
    # graphics memory is mostly compressed would look small by resident size alone.
    return max(row["resident"], row["dirty"] + row["swapped"]) / MIB


def pool_of(event: dict) -> dict:
    """WebGPU canvas pool counters of a page event (empty for renderers that predate them)."""
    return ((event.get("gpu") or {}).get("canvases")) or {}


def _pool_metrics(metrics: dict, event: dict) -> None:
    pool = pool_of(event)
    for key in ("created", "reused", "reconfigured", "destroyed"):
        if key in pool:
            metrics[f"pool.{key}"] = pool[key]
    surfaces = event.get("surfaces") or []
    if "backingStoreResizes" in pool:
        # One shared window canvas: the runtime counts the swapchain allocations.
        metrics["renderer.backing_store_resizes"] = pool["backingStoreResizes"]
    elif surfaces and "backingStoreResizes" in surfaces[0]:
        metrics["renderer.backing_store_resizes"] = sum(s.get("backingStoreResizes", 0) for s in surfaces)


def _surface_total(sample: dict | None, key: str) -> int | None:
    event = (sample or {}).get("event") or {}
    if key == "backingStoreResizes" and "backingStoreResizes" in pool_of(event):
        return pool_of(event)["backingStoreResizes"]
    surfaces = event.get("surfaces") or []
    if not surfaces or key not in surfaces[0]:
        return None
    return sum(s.get(key, 0) for s in surfaces)


def _resize_metrics(metrics: dict, by_phase: dict, named: list[dict]) -> None:
    """Per-drag counters and the peak WebContent / total footprint of the shrink-N and grow-N phases."""
    gestures = [s for s in named if phase_of(s).startswith(("shrink-", "grow-"))]
    if not gestures:
        return
    metrics["resize.gestures"] = len(gestures)
    metrics["resize.peak_total_mib"] = max(total_bytes(s) for s in gestures) / MIB
    metrics["resize.peak_web_content_mib"] = max(footprint_by_role(s).get("web_content", 0) for s in gestures) / MIB
    for key, name in (("backingStoreResizes", "backing_store_resizes"), ("gridResizes", "grid_resizes"), ("deferredGridResizes", "deferred_grid_resizes")):
        previous = _surface_total(by_phase.get("baseline"), key)
        counts = []
        for sample in gestures:
            current = _surface_total(sample, key)
            if previous is not None and current is not None:
                counts.append(current - previous)
            previous = current
        if counts:
            metrics[f"resize.{name}_per_gesture.max"] = max(counts)
            metrics[f"resize.{name}_per_gesture.mean"] = sum(counts) / len(counts)


def roles_present(samples: list[dict]) -> list[str]:
    seen = {role for sample in samples for role in footprint_by_role(sample)}
    ordered = [role for role in ROLE_ORDER if role in seen]
    return ordered + sorted(seen - set(ordered))


def label(role: str) -> str:
    return ROLE_LABEL.get(role, role)


def sample_by_phase(report: dict) -> dict[str, dict]:
    return {phase_of(sample): sample for sample in report["samples"]}


def slope(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 2:
        return None
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    denominator = sum((x - mean_x) ** 2 for x in xs)
    if denominator == 0:
        return None
    return sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denominator


# ---------------------------------------------------------------------------------------------
# Intervals: CPU and energy between two samples
# ---------------------------------------------------------------------------------------------

def _counters(sample: dict, edge: str) -> tuple[dict, int, int | None]:
    """Counters at the start of sampling ('pre') or when sampling finished ('post')."""
    if edge == "post" and sample.get("rusagePost"):
        return sample["rusagePost"], sample["tMonoNsPost"], sample.get("windowServerCpuNsPost")
    return sample.get("rusage") or {}, sample["tMonoNs"], sample.get("windowServerCpuNs")


def interval(start: dict, end: dict) -> dict | None:
    """Resource use between the end of `start`'s sampling and the beginning of `end`'s.

    Returns None for samples without rusage (reports from the older lab).
    """
    before, t0, ws0 = _counters(start, "post")
    after, t1, ws1 = _counters(end, "pre")
    if not before or not after or t1 <= t0:
        return None
    seconds = (t1 - t0) / 1e9
    roles = {}
    complete = True
    for pid, role in (end.get("roles") or {}).items():
        a, b = before.get(pid), after.get(pid)
        if not a or not b or a.get("start_abstime") != b.get("start_abstime"):
            complete = False
            continue
        entry = roles.setdefault(role, {"cpu_ns": 0, "pcpu_ns": 0, "energy_nj": 0, "energy_known": True, "wakeups": 0, "instructions": 0, "cycles": 0})
        entry["cpu_ns"] += b["cpu_ns"] - a["cpu_ns"]
        entry["pcpu_ns"] += b.get("pcpu_ns", 0) - a.get("pcpu_ns", 0)
        entry["wakeups"] += (b["interrupt_wakeups"] - a["interrupt_wakeups"]) + (b["idle_wakeups"] - a["idle_wakeups"])
        entry["instructions"] += b["instructions"] - a["instructions"]
        entry["cycles"] += b["cycles"] - a["cycles"]
        if a["energy_nj"] is None or b["energy_nj"] is None:
            entry["energy_known"] = False
        else:
            entry["energy_nj"] += b["energy_nj"] - a["energy_nj"]
    result = {
        "seconds": seconds,
        "complete": complete,
        "cpu_pct": {role: 100.0 * v["cpu_ns"] / (seconds * 1e9) for role, v in roles.items()},
        "energy_j": {role: v["energy_nj"] / 1e9 for role, v in roles.items() if v["energy_known"]},
        "wakeups_per_s": {role: v["wakeups"] / seconds for role, v in roles.items()},
        "cpu_ns": {role: v["cpu_ns"] for role, v in roles.items()},
        "pcpu_ns": sum(v["pcpu_ns"] for v in roles.values()),
        "instructions": sum(v["instructions"] for v in roles.values()),
        "cycles": sum(v["cycles"] for v in roles.values()),
    }
    result["cpu_pct_total"] = sum(result["cpu_pct"].values())
    result["energy_j_total"] = sum(result["energy_j"].values()) if result["energy_j"] else None
    result["energy_j_per_min"] = {role: v / seconds * 60 for role, v in result["energy_j"].items()}
    result["energy_j_per_min_total"] = (
        result["energy_j_total"] / seconds * 60 if result["energy_j_total"] is not None else None
    )
    result["power_mw_total"] = (
        result["energy_j_total"] / seconds * 1000 if result["energy_j_total"] is not None else None
    )
    result["wakeups_per_s_total"] = sum(result["wakeups_per_s"].values())
    if ws0 is not None and ws1 is not None:
        result["window_server_cpu_pct"] = 100.0 * (ws1 - ws0) / (seconds * 1e9)
    return result


def aggregate(intervals: list[dict]) -> dict | None:
    """Time-weighted combination of several intervals (e.g. every hidden hold of a run)."""
    intervals = [i for i in intervals if i]
    if not intervals:
        return None
    seconds = sum(i["seconds"] for i in intervals)
    roles = {role for i in intervals for role in i["cpu_ns"]}
    cpu_ns = {role: sum(i["cpu_ns"].get(role, 0) for i in intervals) for role in roles}
    energy = {role: sum(i["energy_j"].get(role, 0) for i in intervals) for role in {r for i in intervals for r in i["energy_j"]}}
    result = {
        "seconds": seconds,
        "complete": all(i["complete"] for i in intervals),
        "pcpu_ns": sum(i.get("pcpu_ns", 0) for i in intervals),
        "instructions": sum(i.get("instructions", 0) for i in intervals),
        "cycles": sum(i.get("cycles", 0) for i in intervals),
        "cpu_ns": cpu_ns,
        "cpu_pct": {role: 100.0 * v / (seconds * 1e9) for role, v in cpu_ns.items()},
        "energy_j": energy,
        "energy_j_per_min": {role: v / seconds * 60 for role, v in energy.items()},
        "wakeups_per_s": {},
    }
    result["cpu_pct_total"] = sum(result["cpu_pct"].values())
    result["energy_j_total"] = sum(energy.values()) if energy else None
    result["energy_j_per_min_total"] = result["energy_j_total"] / seconds * 60 if energy else None
    result["power_mw_total"] = result["energy_j_total"] / seconds * 1000 if energy else None
    ws = [i for i in intervals if "window_server_cpu_pct" in i]
    if ws:
        result["window_server_cpu_pct"] = sum(i["window_server_cpu_pct"] * i["seconds"] for i in ws) / sum(i["seconds"] for i in ws)
    return result


# ---------------------------------------------------------------------------------------------
# Metrics (flat, comparable between reports)
# ---------------------------------------------------------------------------------------------

def _cycle_samples(report: dict, step: str) -> list[tuple[int, dict]]:
    found = []
    for sample in report["samples"]:
        event = sample["event"]
        if event.get("step") == step and "cycle" in event:
            found.append((event["cycle"], sample))
    return sorted(found, key=lambda pair: pair[0])


def _add_interval_metrics(metrics: dict, prefix: str, value: dict | None) -> None:
    if not value:
        return
    metrics[f"{prefix}.seconds"] = value["seconds"]
    for role, pct in sorted(value["cpu_pct"].items()):
        metrics[f"{prefix}.cpu_pct.{role}"] = pct
    metrics[f"{prefix}.cpu_pct.total"] = value["cpu_pct_total"]
    if value.get("window_server_cpu_pct") is not None:
        metrics[f"{prefix}.cpu_pct.window_server"] = value["window_server_cpu_pct"]
    for role, joules in sorted(value["energy_j_per_min"].items()):
        metrics[f"{prefix}.energy_j_per_min.{role}"] = joules
    if value.get("energy_j_per_min_total") is not None:
        metrics[f"{prefix}.energy_j_per_min.total"] = value["energy_j_per_min_total"]
        metrics[f"{prefix}.power_mw.total"] = value["power_mw_total"]
    if value.get("wakeups_per_s_total"):
        metrics[f"{prefix}.wakeups_per_s.total"] = value["wakeups_per_s_total"]
    total_cpu = sum(value["cpu_ns"].values())
    if total_cpu and value.get("pcpu_ns") is not None:
        metrics[f"{prefix}.p_core_share_pct"] = 100.0 * value["pcpu_ns"] / total_cpu
    if value.get("instructions"):
        # Work done, independent of core type and frequency: the stable CPU comparison metric.
        metrics[f"{prefix}.instructions_g_per_s"] = value["instructions"] / value["seconds"] / 1e9
        metrics[f"{prefix}.cycles_g_per_s"] = value["cycles"] / value["seconds"] / 1e9


def _footprint_metrics(metrics: dict, name: str, sample: dict) -> None:
    metrics[f"footprint.{name}.total_mib"] = total_bytes(sample) / MIB
    for role, value in footprint_by_role(sample).items():
        metrics[f"footprint.{name}.{role}_mib"] = value / MIB
    for role in ("web_content", "gpu"):
        value = graphics_mib(sample, role)
        if value is not None:
            metrics[f"graphics.{name}.{role}_mib"] = value


def compute_metrics(report: dict) -> dict[str, float]:
    report = usable(report)
    workload = workload_of(report)
    samples = report["samples"]
    by_phase = sample_by_phase(report)
    metrics: dict[str, float] = {}
    if workload == "default":
        for sample in samples:
            metrics[f"footprint.{phase_of(sample)}.total_mib"] = total_bytes(sample) / MIB
        if "repainted" in by_phase:
            _pool_metrics(metrics, by_phase["repainted"]["event"])
        return metrics

    if workload in ("occlusion", "canvas", "tabs"):
        hidden = _cycle_samples(report, "hidden")
        visible = _cycle_samples(report, "visible")
        base = by_phase.get("baseline")
        if base:
            _footprint_metrics(metrics, "baseline", base)
        if visible:
            _footprint_metrics(metrics, "cycle1_visible", visible[0][1])
            _footprint_metrics(metrics, "last_visible", visible[-1][1])
            totals = [total_bytes(s) / MIB for _, s in visible]
            metrics["footprint.max_visible_mib"] = max(totals)
            metrics["footprint.mean_visible_mib"] = sum(totals) / len(totals)
            fit = slope([c for c, _ in visible], totals)
            if fit is not None:
                metrics["footprint.growth_mib_per_cycle"] = fit
            if base:
                metrics["footprint.growth_total_mib"] = totals[-1] - total_bytes(base) / MIB
                for role in roles_present(samples):
                    first = footprint_by_role(base).get(role, 0)
                    last = footprint_by_role(visible[-1][1]).get(role, 0)
                    metrics[f"footprint.growth.{role}_mib"] = (last - first) / MIB
        if hidden:
            totals = [total_bytes(s) / MIB for _, s in hidden]
            metrics["footprint.max_hidden_mib"] = max(totals)
            metrics["footprint.mean_hidden_mib"] = sum(totals) / len(totals)
        for name in ("end+10s", "end+30s", "post-gc+2s", "post-gc+10s", "post-gc+30s"):
            if name in by_phase:
                _footprint_metrics(metrics, name, by_phase[name])
        if "baseline" in by_phase and "end+30s" in by_phase:
            metrics["footprint.settle_delta_vs_baseline_mib"] = (total_bytes(by_phase["end+30s"]) - total_bytes(by_phase["baseline"])) / MIB
        if "end+30s" in by_phase and "post-gc+30s" in by_phase:
            metrics["footprint.gc_recovered_mib"] = (total_bytes(by_phase["end+30s"]) - total_bytes(by_phase["post-gc+30s"])) / MIB
        elif "end+30s" in by_phase and "post-gc+10s" in by_phase:
            metrics["footprint.gc_recovered_mib"] = (total_bytes(by_phase["end+30s"]) - total_bytes(by_phase["post-gc+10s"])) / MIB
        last = samples[-1]["event"] if samples else {}
        canvases = last.get("canvases") or {}
        for key in ("canvasCreated", "canvasFinalized", "contextCreated", "contextFinalized", "configure", "unconfigure", "textureAcquired", "textureFinalized"):
            if key in canvases:
                metrics[f"js.{key}"] = canvases[key]
        metrics["js.domCanvases_max"] = max((s["event"].get("canvases") or {}).get("domCanvases", 0) for s in samples)
        presentation = last.get("presentation") or {}
        metrics["js.reclamations"] = presentation.get("reclamations", 0)
        metrics["js.presentation_transitions"] = presentation.get("transitions", 0)
        _pool_metrics(metrics, last)
        per_cycle = {}  # cycle -> (occluded, reclaimed); control runs carry these on the visible sample
        for _, s in hidden + visible:
            event = s["event"]
            if "hide" not in event and "reclaimedThisCycle" not in event:
                continue
            occluded, reclaimed = per_cycle.get(event["cycle"], (False, False))
            hide = event.get("hide") or {}
            per_cycle[event["cycle"]] = (
                occluded or bool(hide.get("occluded") and hide.get("ok")),
                reclaimed or event.get("reclaimedThisCycle", 0) > 0,
            )
        metrics["cycles.occluded"] = sum(1 for o, _ in per_cycle.values() if o)
        metrics["cycles.reclaimed"] = sum(1 for _, r in per_cycle.values() if r)
        # CPU/energy while hidden vs while visible, time-weighted over every cycle.
        hidden_intervals, visible_intervals = [], []
        previous = base
        for (_, h), (_, v) in zip(hidden, visible):
            if previous:
                hidden_intervals.append(interval(previous, h))
            visible_intervals.append(interval(h, v))
            previous = v
        if hidden:
            _add_interval_metrics(metrics, "hidden", aggregate(hidden_intervals))
            _add_interval_metrics(metrics, "visible", aggregate(visible_intervals))
        elif base and visible:  # control runs take no hidden sample: report the whole loop
            _add_interval_metrics(metrics, "cycles", interval(base, visible[-1][1]))
        return metrics

    if workload in ("move", "resize"):
        named = [s for s in samples if phase_of(s) not in ("blank", "done")]
        for sample in named:
            _footprint_metrics(metrics, phase_of(sample), sample)
        totals = [total_bytes(s) / MIB for s in named]
        metrics["footprint.max_mib"] = max(totals)
        if workload == "resize":
            _resize_metrics(metrics, by_phase, named)
        if "baseline" in by_phase and "settle+30s" in by_phase:
            metrics["footprint.growth_total_mib"] = (total_bytes(by_phase["settle+30s"]) - total_bytes(by_phase["baseline"])) / MIB
        last = samples[-1]["event"]
        canvases = last.get("canvases") or {}
        for key in ("canvasCreated", "canvasFinalized", "contextCreated", "contextFinalized", "configure", "unconfigure", "textureAcquired", "textureFinalized"):
            if key in canvases:
                metrics[f"js.{key}"] = canvases[key]
        metrics["js.reclamations"] = (last.get("presentation") or {}).get("reclamations", 0)
        _pool_metrics(metrics, last)
        for key, value in ((last.get("native") or {}).get("counters") or {}).items():
            metrics[f"native.{key}"] = value
        steps = [s for s in samples if phase_of(s).startswith("steps-") and phase_of(s) != "steps-settled"]
        jumps = [s for s in samples if phase_of(s).startswith("jumps-") and phase_of(s) != "jumps-settled"]
        if "baseline" in by_phase and steps:
            _add_interval_metrics(metrics, "steps", interval(by_phase["baseline"], steps[-1]))
        if "steps-settled" in by_phase and jumps:
            _add_interval_metrics(metrics, "jumps", interval(by_phase["steps-settled"], jumps[-1]))
        return metrics

    # agents / idle
    start, end = by_phase.get("measure-start"), by_phase.get("measure-end")
    if not start or not end:
        return metrics
    _footprint_metrics(metrics, "start", start)
    _footprint_metrics(metrics, "end", end)
    metrics["footprint.delta_mib"] = (total_bytes(end) - total_bytes(start)) / MIB
    window = interval(start, end)
    _add_interval_metrics(metrics, "window", window)
    if window:
        for role, value in sorted(window["wakeups_per_s"].items()):
            metrics[f"window.wakeups_per_s.{role}"] = value
    a, b = start["event"], end["event"]
    seconds = window["seconds"] if window else (end["tMonoNs"] - start["tMonoNs"]) / 1e9
    driver_a, driver_b = a.get("driver") or {}, b.get("driver") or {}
    renders = driver_b.get("renders", 0) - driver_a.get("renders", 0)
    if renders:
        metrics["driver.renders_per_s"] = renders / seconds
        metrics["driver.kib_per_s"] = (driver_b["bytes"] - driver_a["bytes"]) / 1024 / seconds
        metrics["driver.model_write_ms_per_s"] = (driver_b["writeMs"] - driver_a["writeMs"]) / seconds
        samples_lag = driver_b["lagSamples"] - driver_a["lagSamples"]
        if samples_lag:
            metrics["driver.timer_lag_mean_ms"] = (driver_b["lagSumMs"] - driver_a["lagSumMs"]) / samples_lag
        metrics["driver.timer_lag_max_ms"] = driver_b["lagMaxMs"]
    surfaces_a, surfaces_b = a.get("surfaces") or [], b.get("surfaces") or []
    visible_frames = sum(
        s2["frames"] - s1["frames"] for s1, s2 in zip(surfaces_a, surfaces_b) if s2.get("visible")
    )
    metrics["renderer.visible_frames_per_s"] = visible_frames / seconds
    metrics["renderer.uploaded_kib_per_s"] = sum(s2["uploadedBytes"] - s1["uploadedBytes"] for s1, s2 in zip(surfaces_a, surfaces_b)) / 1024 / seconds
    timing_a, timing_b = a.get("renderTiming") or [], b.get("renderTiming") or []
    metrics["renderer.render_callback_ms_per_s"] = sum(t2["milliseconds"] - t1["milliseconds"] for t1, t2 in zip(timing_a, timing_b)) / seconds
    gpu_a, gpu_b = a.get("gpu") or {}, b.get("gpu") or {}
    if gpu_a and gpu_b:
        metrics["renderer.gpu_submissions_per_s"] = (gpu_b["submittedFrames"] - gpu_a["submittedFrames"]) / seconds
        metrics["renderer.atlas_uploads"] = gpu_b["atlasUploads"] - gpu_a["atlasUploads"]
        # Wakeup accounting (renderers that predate these counters leave the metrics out).
        for key, name in (("animationFrames", "animation_frames"), ("idleAnimationFrames", "idle_animation_frames"), ("timerWakeups", "timer_wakeups"), ("workDoneWaits", "work_done_waits")):
            if key in gpu_a and key in gpu_b:
                metrics[f"renderer.{name}_per_s"] = (gpu_b[key] - gpu_a[key]) / seconds
        if "animationFrames" in gpu_a and "animationFrames" in gpu_b:
            metrics["renderer.page_wakeups_per_s"] = metrics["renderer.animation_frames_per_s"] + metrics["renderer.timer_wakeups_per_s"] + metrics["renderer.work_done_waits_per_s"]
        if "stalledFrameRequests" in gpu_a and "stalledFrameRequests" in gpu_b:
            metrics["renderer.stalled_frame_requests_per_s"] = (gpu_b["stalledFrameRequests"] - gpu_a["stalledFrameRequests"]) / seconds

        def mean_delta(path: tuple[str, ...], name: str) -> None:
            def pick(gpu: dict) -> dict | None:
                node = gpu
                for key in path:
                    node = (node or {}).get(key)
                return node

            before, after = pick(gpu_a), pick(gpu_b)
            if before and after and after["count"] > before["count"]:
                metrics[f"renderer.{name}_mean_ms"] = (after["sumMs"] - before["sumMs"]) / (after["count"] - before["count"])
                metrics[f"renderer.{name}_max_ms"] = after["maxMs"]

        mean_delta(("workDoneLatency",), "workdone_latency")
        mean_delta(("frameLatency", "focused"), "frame_latency_focused")
        mean_delta(("frameLatency", "background"), "frame_latency_background")
        submissions = gpu_b["submittedFrames"] - gpu_a["submittedFrames"]
        if submissions:
            metrics["renderer.panes_per_submission"] = visible_frames / submissions
    beats = b.get("heartbeats") or []
    metrics["qualification.heartbeats_unfocused"] = sum(1 for h in beats if not h.get("hasFocus") or h.get("visibility") != "visible")
    return metrics


# ---------------------------------------------------------------------------------------------
# Human summaries
# ---------------------------------------------------------------------------------------------

def table(headers: list[str], rows: list[list[str]], indent: str = "  ") -> str:
    widths = [max(len(str(row[i])) for row in [headers] + rows) for i in range(len(headers))]
    lines = []
    for index, row in enumerate([headers] + rows):
        cells = [str(cell).ljust(widths[0]) if i == 0 else str(cell).rjust(widths[i]) for i, cell in enumerate(row)]
        lines.append(indent + "  ".join(cells))
        if index == 0:
            lines.append(indent + "  ".join("-" * w for w in widths))
    return "\n".join(lines)


def _mib(value: float | None) -> str:
    return "-" if value is None else f"{value:,.1f}"


def _gfx(sample: dict) -> str:
    web, gpu = graphics_mib(sample, "web_content"), graphics_mib(sample, "gpu")
    return "-" if web is None and gpu is None else f"{web or 0:,.0f}/{gpu or 0:,.0f}"


def _footprint_row(sample: dict, roles: list[str], name: str | None = None, previous: dict | None = None) -> list[str]:
    values = footprint_by_role(sample)
    total = total_bytes(sample) / MIB
    row = [name or phase_of(sample)] + [_mib(values.get(role, 0) / MIB) for role in roles] + [_mib(total)]
    row.append("" if previous is None else f"{total - total_bytes(previous) / MIB:+,.1f}")
    return row


def _interval_rows(pairs: list[tuple[str, dict | None]], roles: list[str]) -> list[list[str]]:
    rows = []
    for name, value in pairs:
        if not value:
            continue
        row = [name, f"{value['seconds']:.1f}"]
        row += [f"{value['cpu_pct'].get(role, 0):.2f}" for role in roles]
        row.append(f"{value['cpu_pct_total']:.2f}")
        row.append("-" if value.get("window_server_cpu_pct") is None else f"{value['window_server_cpu_pct']:.2f}")
        row += ["-" if role not in value["energy_j_per_min"] else f"{value['energy_j_per_min'][role]:.2f}" for role in roles]
        row.append("-" if value.get("energy_j_per_min_total") is None else f"{value['energy_j_per_min_total']:.2f}")
        rows.append(row)
    return rows


def _interval_table(pairs: list[tuple[str, dict | None]], roles: list[str]) -> str:
    headers = ["interval", "sec"] + [f"cpu% {label(r)}" for r in roles] + ["cpu% sum", "cpu% WS"] + [f"J/min {label(r)}" for r in roles] + ["J/min sum"]
    rows = _interval_rows(pairs, roles)
    return table(headers, rows) if rows else "  (no CPU/energy counters in this report)"


def summarize(report: dict) -> str:
    report = usable(report)
    workload = workload_of(report)
    samples = report["samples"]
    roles = roles_present(samples)
    config = report.get("config") or {}
    out = [f"== renderer lab: {workload} ==" + (f" [{config.get('label')}]" if config.get("label") else "")]
    out.append(f"  source {report.get('sourceRevision')}  diff {str(report.get('sourceDiffSha256'))[:12]}  qualified: {report.get('qualification', {}).get('qualified', 'n/a')}")
    headers = ["phase"] + [label(r) for r in roles] + ["TOTAL MiB", "delta"]
    by_phase = sample_by_phase(report)

    if workload in ("occlusion", "canvas", "tabs"):
        mode = config.get("occlusionMode", "orderout")
        if workload == "canvas":
            out.append(f"  raw WebGPU canvas probe, variant '{config.get('variant')}' (no Terax renderer)")
        if workload == "tabs":
            out.append(f"  one-pane tab <-> four-pane tab; cycles {config.get('cycles')}; dwell {config.get('dwellMs')} ms on each tab per switch; {config.get('order') or 'hide-first'}" + (f"; park {config.get('parkMs')}" if config.get('parkMs') else ""))
        else:
            out.append(f"  mode {mode}; panes/tab {config.get('panes')}; cycles {config.get('cycles')}; hidden {config.get('hiddenMs')} ms; visible {config.get('visibleMs')} ms"
                   + ("; CONTROL (no reclaim expected)" if config.get("controlNoReclaim") else "")
                   + (f"; forced GC {config.get('forceGc')} ({config.get('gcWhen')})" if config.get("forceGc") not in (None, "none") else ""))
        rows = []
        previous = by_phase.get("baseline")
        if previous:
            rows.append(_footprint_row(previous, roles, "baseline"))
        hidden = dict(_cycle_samples(report, "hidden"))
        for cycle, sample in _cycle_samples(report, "visible"):
            event = sample["event"]
            canvases = event.get("canvases") or {}
            row = _footprint_row(sample, roles, f"cycle {cycle} visible", previous)
            hs = hidden.get(cycle)
            hidden_total = _mib(total_bytes(hs) / MIB) if hs else "-"
            row += [_gfx(sample), hidden_total, f"{canvases.get('contextCreated', '-')}/{canvases.get('contextFinalized', '-')}", f"{canvases.get('textureAcquired', '-')}/{canvases.get('textureFinalized', '-')}", str(canvases.get("domCanvases", "-")), str((event.get("presentation") or {}).get("reclamations", "-"))]
            rows.append(row)
            previous = sample
        for name in ("cycles-complete", "end+10s", "end+30s", "post-gc+2s", "post-gc+10s", "post-gc+30s"):
            if name in by_phase:
                canvases = by_phase[name]["event"].get("canvases") or {}
                rows.append(_footprint_row(by_phase[name], roles, name, previous) + [_gfx(by_phase[name]), "-", f"{canvases.get('contextCreated', '-')}/{canvases.get('contextFinalized', '-')}", f"{canvases.get('textureAcquired', '-')}/{canvases.get('textureFinalized', '-')}", str(canvases.get("domCanvases", "-")), "-"])
                previous = by_phase[name]
        width = len(headers)
        rows = [row + [""] * (width + 6 - len(row)) for row in rows]
        out.append("\nFootprint after each cycle (MiB; hidden = total sampled at the end of the hidden hold;")
        out.append("ctx/tex = WebGPU canvas contexts and swapchain textures created/finalized by JS GC; DOM = canvases in the document;")
        out.append("gfx = vmmap 'owned unmapped (graphics)' of WebContent/GPU, MiB, when recorded):")
        out.append(table(headers + ["gfx WC/GPU", "hidden", "ctx new/gc", "tex new/gc", "DOM", "reclaims"], rows))
        metrics = compute_metrics(report)
        out.append("\nCycles occluded / reclaimed by the presentation policy: {} / {} of {}".format(int(metrics.get("cycles.occluded", 0)), int(metrics.get("cycles.reclaimed", 0)), config.get("cycles")))
        if "footprint.growth_mib_per_cycle" in metrics:
            out.append("Visible-footprint trend: {:+.2f} MiB/cycle; first->last visible {:+.1f} MiB".format(metrics["footprint.growth_mib_per_cycle"], metrics.get("footprint.growth_total_mib", float("nan"))))
        if "pool.created" in metrics:
            out.append("Renderer canvas pool: created {}, reused {}, reconfigured {}, destroyed {}; backing-store resizes {}".format(
                metrics.get("pool.created"), metrics.get("pool.reused"), metrics.get("pool.reconfigured"), metrics.get("pool.destroyed"), metrics.get("renderer.backing_store_resizes", "-")))
        pairs = [("hidden holds", None), ("visible streams", None)]
        pairs = []
        for name in ("hidden", "visible", "cycles"):
            seconds = metrics.get(f"{name}.seconds")
            if seconds is None:
                continue
            pairs.append((name, {
                "seconds": seconds,
                "cpu_pct": {r: metrics.get(f"{name}.cpu_pct.{r}", 0) for r in roles},
                "cpu_pct_total": metrics.get(f"{name}.cpu_pct.total", 0),
                "window_server_cpu_pct": metrics.get(f"{name}.cpu_pct.window_server"),
                "energy_j_per_min": {r: metrics[f"{name}.energy_j_per_min.{r}"] for r in roles if f"{name}.energy_j_per_min.{r}" in metrics},
                "energy_j_per_min_total": metrics.get(f"{name}.energy_j_per_min.total"),
            }))
        out.append("\nCPU / energy, time-weighted over all cycles:")
        out.append(_interval_table(pairs, roles))
    elif workload in ("move", "resize"):
        out.append(f"  steps {config.get('steps')}, jumps {config.get('jumps')}")
        rows, previous = [], None
        for sample in samples:
            if phase_of(sample) in ("blank", "done"):
                continue
            rows.append(_footprint_row(sample, roles, None, previous))
            previous = sample
        out.append("\nFootprint by phase (MiB):")
        out.append(table(headers, rows))
        pairs = []
        steps = [s for s in samples if phase_of(s).startswith("steps-") and phase_of(s) != "steps-settled"]
        jumps = [s for s in samples if phase_of(s).startswith("jumps-") and phase_of(s) != "jumps-settled"]
        if "baseline" in by_phase and steps:
            pairs.append((f"{config.get('steps')} steps", interval(by_phase["baseline"], steps[-1])))
        if "steps-settled" in by_phase and jumps:
            pairs.append((f"{config.get('jumps')} jumps", interval(by_phase["steps-settled"], jumps[-1])))
        out.append("\nCPU / energy:")
        out.append(_interval_table(pairs, roles))
        metrics = compute_metrics(report)
        out.append("\nJS: WebGPU contexts created {} / finalized {}; reclamations {}; native didMove {}, occlusion changes {}".format(
            metrics.get("js.contextCreated", "-"), metrics.get("js.contextFinalized", "-"), metrics.get("js.reclamations", "-"), metrics.get("native.didMove", "-"), metrics.get("native.occlusionChanges", 0)))
        if "pool.created" in metrics:
            out.append("Renderer canvas pool: created {}, reused {}, reconfigured {}, destroyed {}; backing-store resizes {}".format(
                metrics.get("pool.created"), metrics.get("pool.reused"), metrics.get("pool.reconfigured"), metrics.get("pool.destroyed"), metrics.get("renderer.backing_store_resizes", "-")))
        if "resize.gestures" in metrics:
            out.append("Resize gestures {}: peak WebContent {:.1f} MiB, peak total {:.1f} MiB; backing-store resizes per gesture max {} mean {:.1f}{}".format(
                metrics["resize.gestures"], metrics["resize.peak_web_content_mib"], metrics["resize.peak_total_mib"],
                metrics.get("resize.backing_store_resizes_per_gesture.max", "-"), metrics.get("resize.backing_store_resizes_per_gesture.mean", 0),
                "; grid resizes per gesture mean {:.1f} (deferred {:.1f})".format(metrics["resize.grid_resizes_per_gesture.mean"], metrics.get("resize.deferred_grid_resizes_per_gesture.mean", 0)) if "resize.grid_resizes_per_gesture.mean" in metrics else ""))
    elif workload in ("agents", "idle"):
        out.append(f"  visible panes {config.get('panes')}; hidden models {config.get('hidden')}; measured {config.get('duration')} s after {config.get('warmup')} s warm-up; cursor blink {config.get('blink')}")
        rows, previous = [], None
        for sample in samples:
            if phase_of(sample) in ("blank", "done"):
                continue
            rows.append(_footprint_row(sample, roles, None, previous))
            previous = sample
        out.append("\nFootprint by phase (MiB):")
        out.append(table(headers, rows))
        start, end = by_phase.get("measure-start"), by_phase.get("measure-end")
        pairs = [("measured window", interval(start, end))] if start and end else []
        out.append("\nCPU% (of one core) and energy over the measured window:")
        out.append(_interval_table(pairs, roles))
        metrics = compute_metrics(report)
        for key in ("window.power_mw.total", "window.wakeups_per_s.total", "driver.renders_per_s", "driver.kib_per_s", "driver.timer_lag_mean_ms", "renderer.visible_frames_per_s", "renderer.gpu_submissions_per_s", "renderer.panes_per_submission", "renderer.animation_frames_per_s", "renderer.idle_animation_frames_per_s", "renderer.timer_wakeups_per_s", "renderer.work_done_waits_per_s", "renderer.page_wakeups_per_s", "renderer.stalled_frame_requests_per_s", "renderer.workdone_latency_mean_ms", "renderer.frame_latency_focused_mean_ms", "renderer.frame_latency_background_mean_ms", "renderer.render_callback_ms_per_s"):
            if key in metrics:
                out.append(f"  {key}: {metrics[key]:.2f}")
    else:
        rows, previous = [], None
        for sample in samples:
            rows.append(_footprint_row(sample, roles, None, previous))
            previous = sample
        out.append(table(headers, rows))
    qualification = report.get("qualification") or {}
    for advisory in qualification.get("advisories") or []:
        out.append(f"\nADVISORY: {advisory}")
    if qualification.get("failures"):
        out.append("\nQUALIFICATION FAILURES (results are not valid evidence):")
        for failure in qualification["failures"][:12]:
            out.append(f"  - {failure['phase']}: {'; '.join(failure['reasons'])}")
        if len(qualification["failures"]) > 12:
            out.append(f"  ... {len(qualification['failures']) - 12} more")
    for warning in (report.get("warnings") or [])[:8]:
        out.append(f"  warning: {warning}")
    out.append(f"\n  host {report.get('environment', {}).get('chip', '?')}; load average at start {report.get('environment', {}).get('loadAverageStart')}; end {report.get('environment', {}).get('loadAverageEnd')}")
    out.append(f"  scope: {report.get('scope')}")
    return "\n".join(out)


# ---------------------------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------------------------

def _fmt(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:,.2f}" if abs(value) < 100000 else f"{value:,.0f}"


def median_metrics(reports: list[dict]) -> dict[str, float]:
    """Per-metric median across repeated runs (a single report returns its own metrics)."""
    per_report = [compute_metrics(report) for report in reports]
    names = [name for name in per_report[0] if all(name in other for other in per_report)]
    result = {}
    for name in names:
        values = sorted(m[name] for m in per_report)
        mid = len(values) // 2
        result[name] = values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2
    return result


def compare(baseline: dict | list[dict], candidate: dict | list[dict]) -> str:
    baselines = baseline if isinstance(baseline, list) else [baseline]
    candidates = candidate if isinstance(candidate, list) else [candidate]
    baseline, candidate = baselines[0], candidates[0]
    base_metrics, candidate_metrics = median_metrics(baselines), median_metrics(candidates)
    names = list(base_metrics) + [name for name in candidate_metrics if name not in base_metrics]
    out = [f"== comparison: {workload_of(baseline)} (baseline {str(baseline.get('sourceRevision'))[:10]} x{len(baselines)} -> candidate {str(candidate.get('sourceRevision'))[:10]} x{len(candidates)}; medians when repeated) =="]
    if workload_of(baseline) != workload_of(candidate):
        out.append("  warning: workloads differ; matching metric names only")
    for key in ("panes", "hidden", "cycles", "occlusionMode", "duration", "blink"):
        a, b = (baseline.get("config") or {}).get(key), (candidate.get("config") or {}).get(key)
        if a != b:
            out.append(f"  warning: config {key} differs ({a} vs {b})")
    for name, group in (("baseline", baselines), ("candidate", candidates)):
        failed = sum(1 for report in group if not (report.get("qualification") or {}).get("qualified", True))
        if failed:
            out.append(f"  warning: {failed} of {len(group)} {name} reports failed qualification")
    rows = []
    for name in names:
        a, b = base_metrics.get(name), candidate_metrics.get(name)
        if a is None and b is None:
            continue
        delta = None if a is None or b is None else b - a
        percent = "" if delta is None or a == 0 or a is None else f"{100 * delta / abs(a):+.1f}%"
        rows.append([name, _fmt(a), _fmt(b), "-" if delta is None else f"{delta:+,.2f}", percent])
    out.append(table(["metric", "baseline", "candidate", "delta", "%"], rows))
    return "\n".join(out)


def load(path: Path) -> dict:
    report = json.loads(Path(path).read_text())
    if isinstance(report.get("humanSummary"), list):
        report["humanSummary"] = "\n".join(report["humanSummary"])
    return report


def dump(report: dict) -> str:
    """Readable but compact JSON: summaries and metrics pretty-printed, raw samples one per line."""
    parts = []
    for key, value in report.items():
        if key in ("samples", "series", "nativeEvents") and isinstance(value, list):
            body = ",\n".join("  " + json.dumps(item, separators=(",", ":")) for item in value)
            parts.append(f" {json.dumps(key)}: [\n{body}\n ]")
            continue
        if key == "humanSummary" and isinstance(value, str):
            value = value.splitlines()
        parts.append(f" {json.dumps(key)}: " + json.dumps(value, indent=1).replace("\n", "\n "))
    return "{\n" + ",\n".join(parts) + "\n}\n"


def finite(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)
