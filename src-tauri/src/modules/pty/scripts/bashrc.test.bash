#!/usr/bin/env bash
# Shell integration tests for bashrc.bash. Run: bash bashrc.test.bash
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rcfile="$script_dir/bashrc.bash"
failures=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf 'ok   %s\n' "$label"
  else
    printf 'FAIL %s: expected %s, got %s\n' "$label" "$expected" "$actual"
    failures=$((failures + 1))
  fi
}

# --- cwd reporting ----------------------------------------------------------
# Drives the rc file in a pty and prints one line per OSC 7 path reported.
cwd_reports() {
  HOME="$1" python3 - "$rcfile" <<'PY'
import os, pty, re, select, sys, time

pid, fd = pty.fork()
if pid == 0:
    os.execvp("bash", ["bash", "--rcfile", sys.argv[1], "-i"])

out = b""

def drain(seconds):
    global out
    end = time.time() + seconds
    while time.time() < end:
        if select.select([fd], [], [], 0.2)[0]:
            try:
                out += os.read(fd, 65536)
            except OSError:
                return

drain(2.0)
for line in ("cd /etc\n", "cd /usr\n", "exit\n"):
    os.write(fd, line.encode())
    drain(1.0)

# OSC 7 payload is file://<host><path>; keep the path, drop the host.
text = out.decode("utf-8", "replace")
for path in re.findall(r"\]7;file://[^/\x1b\x07]*([^\x1b\x07]*)", text):
    print(path.rstrip("/") or "/")
PY
}

empty_home="$(mktemp -d)"
trap 'rm -rf "$empty_home"' EXIT

mapfile -t reported < <(cwd_reports "$empty_home")
check "reports cwd after cd /etc" 1 "$(printf '%s\n' "${reported[@]}" | grep -c '^/etc$')"
check "reports cwd after cd /usr" 1 "$(printf '%s\n' "${reported[@]}" | grep -c '^/usr$')"

# --- hook installation ------------------------------------------------------
# Sources the rc file with a fake environment and reports where the precmd
# hook ended up. Stubbing ble.sh keeps this deterministic: a real ble.sh owns
# the line editor and released builds will not accept piped input at all, so
# there is no portable way to make one run a command from a test.
hook_targets() {
  local fake_ble="$1"
  HOME="$empty_home" TERAX_FAKE_BLE="$fake_ble" bash --norc --noprofile -c '
    if [ -n "$TERAX_FAKE_BLE" ]; then
      BLE_VERSION=0.4.0-test
      blehook() { printf "BLEHOOK:%s\n" "$*"; }
    fi
    source "$1" 2>/dev/null
    printf "PROMPT_COMMAND:%s\n" "${PROMPT_COMMAND-}"
  ' _ "$rcfile" 2>/dev/null
}

# Without a line editor, the PROMPT_COMMAND chain is the only hook point.
plain="$(hook_targets "")"
case "$plain" in
  *"PROMPT_COMMAND:"*_terax_precmd*) check "plain bash hooks PROMPT_COMMAND" pass pass ;;
  *) check "plain bash hooks PROMPT_COMMAND" pass "missing" ;;
esac

# Regression: ble.sh snapshots PROMPT_COMMAND at ble-attach, which has already
# run by the time we append to it, and manages its own copy from then on. Our
# hook was silently dropped, so the host saw one OSC 7 at startup and nothing
# on cd -- the file explorer stayed frozen on the spawn directory. ble.sh's own
# hook list survives that handover, so register there too.
with_ble="$(hook_targets 1)"
case "$with_ble" in
  *"BLEHOOK:PRECMD+=_terax_precmd"*) check "ble.sh gets a blehook PRECMD" pass pass ;;
  *) check "ble.sh gets a blehook PRECMD" pass "missing" ;;
esac

# The blehook registration is additive, not a replacement: PROMPT_COMMAND must
# still carry the hook for anything that does not go through ble.sh.
case "$with_ble" in
  *"PROMPT_COMMAND:"*_terax_precmd*) check "ble.sh keeps PROMPT_COMMAND too" pass pass ;;
  *) check "ble.sh keeps PROMPT_COMMAND too" pass "missing" ;;
esac

exit $((failures > 0))
