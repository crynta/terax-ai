#!/bin/bash
# Runs the standard renderer-lab suite sequentially (one window at a time, never in parallel)
# and writes one report per run:
#
#   suite.sh REPORT_PREFIX [BASELINE_PREFIX] [-- run.py arguments...]
#
#   REPORT_PREFIX    reports are written to REPORT_PREFIX-<name>.json (repeats: -<name>-r2.json ...)
#   BASELINE_PREFIX  optional; each run is compared with the BASELINE_PREFIX-<name>[-rN].json
#                    reports (per-metric medians when several exist)
#   REPEATS          environment variable, repetitions of the CPU/energy workloads (default 3)
#
# CPU time and energy depend on whether macOS schedules the work on performance or efficiency
# cores (the same agents workload measured 9% vs 20% CPU and 207 vs 50 mW in two runs), so
# compare medians of repeated runs and prefer the instructions/s and cycles/s metrics.
#
# Example (baseline from a pristine archive, then a candidate from the working tree):
#   git archive <rev> src packages package.json tsconfig.json tsconfig.node.json | tar -x -C /tmp/base
#   ln -s "$PWD/node_modules" /tmp/base/node_modules
#   scripts/renderer-profile/suite.sh docs/architecture/resource-evidence/baseline -- \
#       --source /tmp/base --revision <rev> --output /tmp/lab-base --reuse-build
#   scripts/renderer-profile/suite.sh docs/architecture/resource-evidence/candidate \
#       docs/architecture/resource-evidence/baseline -- --output /tmp/lab-candidate --reuse-build
#
# Keep the machine awake, unlocked and otherwise idle: the benchmark window must stay visible
# and focused. Add `--wait-unlocked SECONDS` after `--` to wait for an unlocked session.
set -u
shopt -s nullglob
here="$(cd "$(dirname "$0")" && pwd)"
prefix="${1:?usage: suite.sh REPORT_PREFIX [BASELINE_PREFIX] [-- run.py args...]}"
shift
baseline=""
if [ $# -gt 0 ] && [ "$1" != "--" ]; then
  baseline="$1"
  shift
fi
[ "${1:-}" = "--" ] && shift
extra=("$@")
repeats="${REPEATS:-3}"

status=0
run() {
  local name="$1" times="$2"
  shift 2
  local compare=() n out
  if [ -n "$baseline" ]; then
    local found=("$baseline-$name.json" "$baseline-$name"-r*.json)
    for f in "${found[@]}"; do [ -f "$f" ] && compare+=("$f"); done
  fi
  for ((n = 1; n <= times; n++)); do
    out="$prefix-$name.json"
    [ "$n" -gt 1 ] && out="$prefix-$name-r$n.json"
    echo "=== $name run $n/$times $(date +%T) load $(sysctl -n vm.loadavg)"
    if [ ${#compare[@]} -gt 0 ]; then
      python3 "$here/run.py" --report "$out" "$@" --compare "${compare[@]}" ${extra[@]+"${extra[@]}"} || status=$?
    else
      python3 "$here/run.py" --report "$out" "$@" ${extra[@]+"${extra[@]}"} || status=$?
    fi
  done
}

run occlusion-orderout 1 --workload occlusion --occlusion-mode orderout
run agents-1pane "$repeats" --workload agents --panes 1
run agents-4panes "$repeats" --workload agents --panes 4
run idle-1pane "$repeats" --workload idle --panes 1
run idle-4panes "$repeats" --workload idle --panes 4
run move 1 --workload move
exit $status
