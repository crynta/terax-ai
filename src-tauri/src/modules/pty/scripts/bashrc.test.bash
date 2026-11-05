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

reported="$(cwd_reports "$empty_home")"
check "reports cwd after cd /etc" 1 "$(printf '%s\n' "$reported" | grep -c '^/etc$')"
check "reports cwd after cd /usr" 1 "$(printf '%s\n' "$reported" | grep -c '^/usr$')"

# --- hook installation ------------------------------------------------------
# Sources the rc file with a fake environment and runs a probe against it.
# Stubbing ble.sh keeps this deterministic: a real ble.sh owns the line editor
# and released builds will not accept piped input at all, so there is no
# portable way to make one run a command from a test. The stub mirrors what
# matters about it: blehook keeps its own list, and an attached ble.sh restores
# its own copy of PROMPT_COMMAND before every prompt.
integration() {
  local fake_ble="$1" probe="$2" prompt_command="${3-}"
  HOME="$empty_home" TERAX_FAKE_BLE="$fake_ble" TERAX_PROBE="$probe" \
    TERAX_PC="$prompt_command" bash --norc --noprofile -c '
    PS1="user> "
    case "$TERAX_PC" in
      "") ;;
      "("*) eval "PROMPT_COMMAND=$TERAX_PC" ;;
      *) PROMPT_COMMAND="$TERAX_PC" ;;
    esac
    if [ -n "$TERAX_FAKE_BLE" ]; then
      BLE_VERSION=0.4.0-test
      BLEHOOKS=
      blehook() { BLEHOOKS="$BLEHOOKS$*;"; }
    fi
    source "$1" >/dev/null 2>&1
    eval "$TERAX_PROBE"
  ' _ "$rcfile" 2>/dev/null
}

contains() {
  case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac
}

expect_contains() {
  if contains "$3" "$2"; then check "$1" pass pass; else check "$1" pass "missing: $2 in $3"; fi
}

expect_lacks() {
  if contains "$3" "$2"; then check "$1" pass "unexpected: $2"; else check "$1" pass pass; fi
}

# Without a line editor, the PROMPT_COMMAND chain is the only hook point.
plain="$(integration "" 'printf "PROMPT_COMMAND:%s|BLEHOOKS:%s\n" "${PROMPT_COMMAND-}" "${BLEHOOKS-}"')"
expect_contains "plain bash hooks PROMPT_COMMAND" "PROMPT_COMMAND:_terax_precmd" "$plain"
expect_contains "plain bash never touches blehook" "BLEHOOKS:" "$plain"
expect_lacks "plain bash registers no ble.sh hook" "PRECMD" "$plain"

# Regression: an attached ble.sh manages its own copy of PROMPT_COMMAND, which
# has already been handed over by the time the hook is appended to it. Our hook
# was silently dropped, so the host saw one OSC 7 at startup and nothing on cd.
# ble.sh's own hook list survives that handover.
with_ble="$(integration 1 'printf "PROMPT_COMMAND:%s|BLEHOOKS:%s\n" "${PROMPT_COMMAND-}" "${BLEHOOKS-}"')"
expect_contains "ble.sh gets a blehook PRECMD, once-only form" "BLEHOOKS:PRECMD!=_terax_ble_precmd;" "$with_ble"
expect_contains "ble.sh keeps PROMPT_COMMAND too" "PROMPT_COMMAND:_terax_precmd" "$with_ble"

# The ble.sh entry reports the prompt when PROMPT_COMMAND was dropped by ble.sh.
dropped="$(integration 1 'PROMPT_COMMAND=; (exit 3); _terax_ble_precmd; printf "|status=%s" "$?"')"
expect_contains "ble.sh entry reports the command status" "133;D;3" "$dropped"
expect_contains "ble.sh entry reports the cwd" "]7;file://" "$dropped"
expect_contains "ble.sh entry marks the prompt start" "133;A" "$dropped"
expect_contains "ble.sh entry preserves the status" "|status=3" "$dropped"

# ...and stays silent when PROMPT_COMMAND will run the hook anyway, so a prompt
# is never reported twice.
shared="$(integration 1 '(exit 5); _terax_ble_precmd; printf "|status=%s" "$?"')"
expect_lacks "ble.sh entry does not repeat a PROMPT_COMMAND hook" "133;D" "$shared"
expect_contains "the skipped ble.sh entry preserves the status" "|status=5" "$shared"

# An array PROMPT_COMMAND and one with a trailing separator both keep working.
array="$(integration "" 'printf "%s" "${PROMPT_COMMAND[*]}"' 'echo user;')"
expect_contains "scalar PROMPT_COMMAND is kept after the hook" "_terax_precmd;echo user;" "$array"

# --- precmd behaviour -------------------------------------------------------
status_after="$(integration "" '(exit 7); _terax_precmd >/dev/null; printf "%s" "$?"')"
check "precmd returns the status it was given" 7 "$status_after"

# The prompt end runs last in PROMPT_COMMAND, after every framework that rebuilds
# PS1. Bash before 4.4 tags the marker as having no PS0 to pair with.
prompt_end="$(integration "" 'PS1="user> "; _terax_finish_prompt; printf "%s" "$PS1"')"
check "prompt end follows the prompt text" 'user> \[\e]133;B\e\\\]' "${prompt_end/;terax_blocks=0/}"

reinjected="$(integration "" '
  _terax_finish_prompt
  PS1="framework> "
  _terax_finish_prompt
  _terax_finish_prompt
  printf "%s" "$PS1"')"
check "prompt end is restored once after a framework rebuilt PS1" 'framework> \[\e]133;B\e\\\]' "${reinjected/;terax_blocks=0/}"

finish_status="$(integration "" '(exit 9); _terax_finish_prompt; printf "%s" "$?"')"
check "the prompt end hook keeps the status too" 9 "$finish_status"

last_scalar="$(integration "" 'printf "%s" "$PROMPT_COMMAND"' 'starship_precmd')"
check "the prompt end is the last PROMPT_COMMAND entry" "$(printf '_terax_precmd;starship_precmd\n_terax_finish_prompt')" "$last_scalar"

# On bash before 5.1 an array PROMPT_COMMAND runs only element 0, so that
# element has to carry both hooks; from 5.1 every element runs.
array_last="$(integration "" 'printf "%s|" "${PROMPT_COMMAND[@]}"' '(one two)')"
case "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}" in
  5.[1-9]*|[6-9].*) check "an array PROMPT_COMMAND gets the hooks as elements" "_terax_precmd|one|two|_terax_finish_prompt|" "$array_last" ;;
  *) check "an old bash array keeps its element 0 as one command" "_terax_precmd;one"$'\n'"_terax_finish_prompt|two|" "$array_last" ;;
esac

nounset="$(integration "" 'set -u; unset TERAX_BLOCKS _terax_block_seen; unset PS1; _terax_precmd >/dev/null; _terax_finish_prompt; printf ok')"
check "the hooks do not abort under set -u" ok "$nounset"

ble_last="$(integration 1 'PROMPT_COMMAND=; _terax_ble_precmd >/dev/null; printf "%s" "$PROMPT_COMMAND"')"
check "the ble.sh entry puts the prompt end back last" _terax_finish_prompt "$ble_last"

# A prompt framework that rebuilds PS1 on every prompt, the way starship does,
# must still end each prompt with the marker: drive a real bash through it.
framework_prompts() {
  local home="$1"
  printf 'fw() { PS1="fw> "; }\nPROMPT_COMMAND=fw\n' > "$home/.bashrc"
  HOME="$home" python3 - "$rcfile" <<'PY'
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
for line in ("true\n", "false\n", "exit\n"):
    os.write(fd, line.encode())
    drain(1.0)

text = out.decode("utf-8", "replace")
a = len(re.findall(r"\x1b\]133;A", text))
b = len(re.findall(r"\x1b\]133;B", text))
after_text = len(re.findall(r"fw> \x1b\]133;B", text))
print(f"A={a} B={b} AFTER={after_text}")
PY
}
framework_home="$(mktemp -d)"
result="$(framework_prompts "$framework_home")"
rm -rf "$framework_home"
a="${result#A=}"; a="${a%% *}"
after="${result##*AFTER=}"
check "every prompt of a PS1-rebuilding framework ends with the prompt end after its text" 1 "$([ "$a" -ge 3 ] && [ "$after" -ge 3 ] && echo 1 || echo "$result")"

exit $((failures > 0))
