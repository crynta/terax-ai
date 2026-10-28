"""Per-process resource accounting for the renderer lab (macOS only, no root required).

Uses proc_pid_rusage() with RUSAGE_INFO_V6 (falls back to V4) for processes owned by the
current user, which covers the lab host and its WebKit helpers. WindowServer belongs to another
user, so proc_pid_rusage is refused (EPERM); its cumulative CPU time comes from `ps` instead
(10 ms resolution) and it has no energy counter without root.
"""

import ctypes
import os
import re
import subprocess
import threading
import time

_libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
_libsystem = ctypes.CDLL("/usr/lib/libSystem.B.dylib")


class _Timebase(ctypes.Structure):
    _fields_ = [("numer", ctypes.c_uint32), ("denom", ctypes.c_uint32)]


_timebase = _Timebase()
_libsystem.mach_timebase_info(ctypes.byref(_timebase))

_V4_FIELDS = (
    "ri_user_time ri_system_time ri_pkg_idle_wkups ri_interrupt_wkups ri_pageins ri_wired_size "
    "ri_resident_size ri_phys_footprint ri_proc_start_abstime ri_proc_exit_abstime "
    "ri_child_user_time ri_child_system_time ri_child_pkg_idle_wkups ri_child_interrupt_wkups "
    "ri_child_pageins ri_child_elapsed_abstime ri_diskio_bytesread ri_diskio_byteswritten "
    "ri_cpu_time_qos_default ri_cpu_time_qos_maintenance ri_cpu_time_qos_background "
    "ri_cpu_time_qos_utility ri_cpu_time_qos_legacy ri_cpu_time_qos_user_initiated "
    "ri_cpu_time_qos_user_interactive ri_billed_system_time ri_serviced_system_time "
    "ri_logical_writes ri_lifetime_max_phys_footprint ri_instructions ri_cycles "
    "ri_billed_energy ri_serviced_energy ri_interval_max_phys_footprint ri_runnable_time"
).split()
_V6_FIELDS = _V4_FIELDS + (
    "ri_flags ri_user_ptime ri_system_ptime ri_pinstructions ri_pcycles ri_energy_nj "
    "ri_penergy_nj ri_secure_time_in_system ri_secure_ptime_in_system ri_neural_footprint "
    "ri_lifetime_max_neural_footprint ri_interval_max_neural_footprint"
).split()


class _RusageV4(ctypes.Structure):
    _fields_ = [("ri_uuid", ctypes.c_uint8 * 16)] + [(name, ctypes.c_uint64) for name in _V4_FIELDS]


class _RusageV6(ctypes.Structure):
    _fields_ = (
        [("ri_uuid", ctypes.c_uint8 * 16)]
        + [(name, ctypes.c_uint64) for name in _V6_FIELDS]
        + [("ri_reserved", ctypes.c_uint64 * 9)]
    )


_libproc.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
_libproc.proc_pid_rusage.restype = ctypes.c_int


def ticks_to_ns(ticks: int) -> int:
    """Convert mach absolute time units (what rusage reports) to nanoseconds."""
    return ticks * _timebase.numer // _timebase.denom


def rusage(pid: int) -> dict | None:
    """Cumulative counters for `pid`, or None if it is gone or inaccessible."""
    for flavor, structure in ((6, _RusageV6), (4, _RusageV4)):
        value = structure()
        if _libproc.proc_pid_rusage(pid, flavor, ctypes.byref(value)) != 0:
            if flavor == 6 and ctypes.get_errno() == 1:  # EPERM: another user's process
                return None
            continue
        user = ticks_to_ns(value.ri_user_time)
        system = ticks_to_ns(value.ri_system_time)
        result = {
            "flavor": flavor,
            "user_ns": user,
            "system_ns": system,
            "cpu_ns": user + system,
            "energy_nj": getattr(value, "ri_energy_nj", None),
            "penergy_nj": getattr(value, "ri_penergy_nj", None),
            "billed_energy": value.ri_billed_energy,
            "serviced_energy": value.ri_serviced_energy,
            "instructions": value.ri_instructions,
            "cycles": value.ri_cycles,
            "interrupt_wakeups": value.ri_interrupt_wkups,
            "idle_wakeups": value.ri_pkg_idle_wkups,
            "runnable_ns": ticks_to_ns(value.ri_runnable_time),
            "phys_footprint": value.ri_phys_footprint,
            "lifetime_max_phys_footprint": value.ri_lifetime_max_phys_footprint,
            "resident": value.ri_resident_size,
            "diskio_read": value.ri_diskio_bytesread,
            "diskio_written": value.ri_diskio_byteswritten,
            "logical_writes": value.ri_logical_writes,
            "start_abstime": value.ri_proc_start_abstime,
        }
        if flavor == 6:
            result["pcpu_ns"] = ticks_to_ns(value.ri_user_ptime + value.ri_system_ptime)
        return result
    return None


def process_table() -> dict[int, tuple[int, str]]:
    """pid -> (ppid, command path) for every process."""
    table = {}
    for line in subprocess.check_output(["ps", "-axo", "pid=,ppid=,comm="], text=True).splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3:
            table[int(parts[0])] = (int(parts[1]), parts[2])
    return table


ROLE_BY_NAME = {
    "renderer-lab": "host",
    "com.apple.WebKit.WebContent": "web_content",
    "com.apple.WebKit.GPU": "gpu",
    "com.apple.WebKit.Networking": "networking",
}
ROLE_ORDER = ["host", "web_content", "web_content_prewarmed", "gpu", "networking"]
ROLE_LABEL = {
    "host": "host",
    "web_content": "WebContent",
    "web_content_prewarmed": "WC-prewarm",
    "gpu": "GPU",
    "networking": "Network",
}


def role_of(command: str, prewarmed: bool = False) -> str | None:
    role = ROLE_BY_NAME.get(os.path.basename(command))
    if role == "web_content" and prewarmed:
        return "web_content_prewarmed"
    return role


def resolve_members(native: dict) -> tuple[dict[int, str], list[str]]:
    """Map pid -> role from the pids the native host reported for its own WKWebView.

    The host asks WebKit for the exact web, GPU and networking process identifiers, so
    attribution is exact even when other applications share the launching process's
    coalition (which makes coalition-based discovery ambiguous).
    """
    table = process_table()
    members: dict[int, str] = {}
    warnings: list[str] = []
    wanted = [
        (native.get("hostPid"), "host", False),
        (native.get("webContentPid"), "web_content", False),
        (native.get("gpuPid"), "gpu", False),
        (native.get("networkingPid"), "networking", False),
    ] + [(pid, "web_content", True) for pid in native.get("prewarmedPids") or []]
    for pid, expected, prewarmed in wanted:
        if not pid or pid <= 0:
            warnings.append(f"{expected} pid not reported")
            continue
        entry = table.get(pid)
        role = role_of(entry[1], prewarmed) if entry else None
        if role is None or (role.split("_prewarmed")[0] != expected):
            warnings.append(f"pid {pid} is not the expected {expected} process")
            continue
        members[pid] = role
    return members, warnings


def _parse_cpu_time(text: str) -> int | None:
    """Parse ps TIME ([[dd-]hh:]mm:ss[.cc]) to nanoseconds."""
    text = text.strip()
    if not text:
        return None
    days = 0
    if "-" in text:
        day, text = text.split("-", 1)
        days = int(day)
    fields = text.split(":")
    try:
        seconds = float(fields[-1])
        minutes = int(fields[-2]) if len(fields) > 1 else 0
        hours = int(fields[-3]) if len(fields) > 2 else 0
    except ValueError:
        return None
    return round(((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1e9)


def ps_cpu_ns(pid: int) -> int | None:
    result = subprocess.run(["ps", "-o", "time=", "-p", str(pid)], capture_output=True, text=True)
    return _parse_cpu_time(result.stdout) if result.returncode == 0 else None


_SIZE_UNITS = {"": 1, "K": 1024, "M": 1024**2, "G": 1024**3}
_VMMAP_ROW = re.compile(
    r"^(?P<name>\S.*?)\s{2,}" + r"\s+".join(rf"(?P<{key}>[\d.]+[KMG]?)" for key in ("virtual", "resident", "dirty", "swapped", "volatile", "nonvol", "empty")) + r"\s+(?P<count>\d+)"
)


def _vmmap_bytes(text: str) -> int:
    match = re.fullmatch(r"([\d.]+)([KMG]?)", text)
    return round(float(match.group(1)) * _SIZE_UNITS[match.group(2)]) if match else 0


def vmmap_summary(pid: int) -> dict | None:
    """`vmmap -summary` region table. Unlike `footprint`, it names graphics memory the process
    owns without mapping ("owned unmapped (graphics)": IOSurface/canvas backing stores)."""
    try:
        result = subprocess.run(["vmmap", "-summary", str(pid)], capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return None
    if result.returncode != 0:
        return None
    physical = None
    regions: dict[str, dict] = {}
    for line in result.stdout.splitlines():
        if line.startswith("Physical footprint:"):
            physical = _vmmap_bytes(line.split()[-1])
        elif line.startswith("MALLOC ZONE"):
            break  # the second table has a different layout
        else:
            match = _VMMAP_ROW.match(line)
            if match and match["name"] not in ("VIRTUAL",):
                regions[match["name"].strip()] = {
                    **{key: _vmmap_bytes(match[key]) for key in ("virtual", "resident", "dirty", "swapped")},
                    "count": int(match["count"]),
                }
    return {"physicalFootprint": physical, "regions": regions}


def find_pid(name: str) -> int | None:
    result = subprocess.run(["pgrep", "-x", name], capture_output=True, text=True)
    pids = result.stdout.split()
    return int(pids[0]) if pids else None


class Poller(threading.Thread):
    """Lightweight 1 Hz timeline of cumulative CPU/energy/footprint counters."""

    def __init__(self, interval: float = 1.0, window_server_pid: int | None = None):
        super().__init__(daemon=True)
        self.interval = interval
        self.window_server_pid = window_server_pid
        self.members: dict[int, str] = {}
        self.series: list[dict] = []
        self._lock = threading.Lock()
        self._halt = threading.Event()

    def set_members(self, members: dict[int, str]) -> None:
        with self._lock:
            self.members = dict(members)

    def stop(self) -> None:
        self._halt.set()

    def run(self) -> None:
        while not self._halt.wait(self.interval):
            with self._lock:
                members = dict(self.members)
            if not members:
                continue
            entry = {"tMonoNs": time.monotonic_ns(), "tWall": time.time(), "processes": {}}
            for pid, role in members.items():
                value = rusage(pid)
                if value:
                    entry["processes"][str(pid)] = {
                        "role": role,
                        "cpu_ns": value["cpu_ns"],
                        "energy_nj": value["energy_nj"],
                        "phys_footprint": value["phys_footprint"],
                    }
            if self.window_server_pid:
                entry["windowServerCpuNs"] = ps_cpu_ns(self.window_server_pid)
            self.series.append(entry)
