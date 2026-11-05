# terax-shell-integration (bashrc)
#
# Differences vs zsh integration:
# - We emulate login-shell init manually (/etc/profile, profile files) because
#   bash ignores --rcfile when started with -l.
# - Pre-exec marker uses PS0 (bash 4.4+). On older bash (macOS default 3.2) we
#   skip it — a fragile DEBUG-trap alternative would clobber the user's own
#   traps and interact badly with debuggers.

if [ -z "${__TERAX_HOOKS_LOADED-}" ]; then
  __TERAX_HOOKS_LOADED=1

  [ -f /etc/profile ] && source /etc/profile
  [ -f /etc/bashrc ] && source /etc/bashrc
  if [ -f "$HOME/.bash_profile" ]; then
    source "$HOME/.bash_profile"
  elif [ -f "$HOME/.bash_login" ]; then
    source "$HOME/.bash_login"
  elif [ -f "$HOME/.profile" ]; then
    source "$HOME/.profile"
  fi
  # .bashrc may have been sourced already by .bash_profile; sourcing again is
  # safe for idempotent rc files (the common case). If yours has side effects
  # on reload, guard with a flag.
  [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"

  _terax_prompt_end='\[\e]133;B\e\\\]'
  if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ] \
     || { [ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -lt 4 ]; }; then
    unset TERAX_BLOCKS
    _terax_prompt_end='\[\e]133;B;terax_blocks=0\e\\\]'
  fi

  if [ -n "${TERAX_CLI-}" ] && [ -x "${TERAX_CLI-}" ]; then
    terax() {
      command "$TERAX_CLI" "$@"
    }
  fi

  # URL-encodes $1 into REPLY; no command substitution, a fork per prompt is
  # pure latency.
  _terax_urlencode() {
    local LC_ALL=C s="$1" i c
    REPLY=
    for (( i=0; i<${#s}; i++ )); do
      c="${s:i:1}"
      case "$c" in
        [a-zA-Z0-9/._~-]) REPLY+="$c" ;;
        *) printf -v c '%%%02X' "'$c"; REPLY+="$c" ;;
      esac
    done
  }

  # Returns the status it was called with, so the PROMPT_COMMAND entries after
  # it (starship, direnv, ...) still see the user's `$?`.
  _terax_precmd() {
    local _terax_ret=$? _terax_cwd="$PWD"
    printf '\e]133;D;%s\e\\' "$_terax_ret"
    case "$_terax_cwd" in
      *[!a-zA-Z0-9/._~-]*) _terax_urlencode "$_terax_cwd"; _terax_cwd="$REPLY" ;;
    esac
    printf '\e]7;file://%s%s\e\\' "${HOSTNAME:-$(uname -n 2>/dev/null)}" "$_terax_cwd"
    printf '\e]133;A\e\\'
    return "$_terax_ret"
  }

  # Runs last in PROMPT_COMMAND, after every prompt framework (starship, ...)
  # rebuilt PS1: the prompt end goes after the prompt text, and in block mode
  # the shell prompt is suppressed for the host's input bar. Appended again
  # whenever a framework dropped it; forks nothing.
  _terax_finish_prompt() {
    local _terax_ret=$?
    if [ -n "${TERAX_BLOCKS-}" ]; then
      # Host renders its own input bar: suppress the shell prompt (B marker
      # only) and reserve header/gap rows, mirroring the zsh integration.
      if [ -n "${_terax_block_seen-}" ]; then
        PS1='\n\n\[\e]133;B\e\\\]'
      else
        PS1='\n\[\e]133;B\e\\\]'
      fi
    else
      case "${PS1-}" in
        *']133;B'*) ;;
        *) PS1="${PS1-}${_terax_prompt_end}" ;;
      esac
    fi
    return "$_terax_ret"
  }

  # bash 5.1 runs every element of an array PROMPT_COMMAND; older versions run
  # only element 0, where the array has to be treated as one command string.
  _terax_pc_runs_arrays() {
    [ "${BASH_VERSINFO[0]:-0}" -gt 5 ] \
      || { [ "${BASH_VERSINFO[0]:-0}" -eq 5 ] && [ "${BASH_VERSINFO[1]:-0}" -ge 1 ]; }
  }

  # Puts _terax_finish_prompt last in PROMPT_COMMAND, once. Called again by the
  # ble.sh hook, which restores a PROMPT_COMMAND that never saw it.
  _terax_pc_finish_last() {
    case "${PROMPT_COMMAND[*]-}" in *_terax_finish_prompt*) return 0 ;; esac
    case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in
      'declare -a'*)
        if _terax_pc_runs_arrays; then
          PROMPT_COMMAND+=(_terax_finish_prompt)
        else
          PROMPT_COMMAND[0]="${PROMPT_COMMAND[0]-}"$'\n'"_terax_finish_prompt"
        fi
        ;;
      *)
        PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND$'\n'}_terax_finish_prompt"
        ;;
    esac
  }

  # ble.sh runs this from its own PRECMD hook list (see below). When a
  # PROMPT_COMMAND that still names _terax_precmd is going to run anyway, as it
  # does for a ble.sh that attaches from the prompt, this only makes sure the
  # prompt end still runs last, so the prompt is never reported twice.
  _terax_ble_precmd() {
    local _terax_ret=$?
    case "${PROMPT_COMMAND[*]-}" in
      *_terax_precmd*) ;;
      *) (exit "$_terax_ret"); _terax_precmd ;;
    esac
    _terax_pc_finish_last
    return "$_terax_ret"
  }

  case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in
    'declare -a'*)
      if _terax_pc_runs_arrays; then
        _terax_has_precmd=
        for _terax_command in "${PROMPT_COMMAND[@]}"; do
          [ "$_terax_command" = _terax_precmd ] && _terax_has_precmd=1
        done
        if [ -z "$_terax_has_precmd" ]; then
          PROMPT_COMMAND=(_terax_precmd "${PROMPT_COMMAND[@]}")
        fi
        unset _terax_has_precmd _terax_command
      else
        case "${PROMPT_COMMAND[0]-}" in
          *_terax_precmd*) ;;
          *) PROMPT_COMMAND[0]="_terax_precmd${PROMPT_COMMAND[0]:+;${PROMPT_COMMAND[0]}}" ;;
        esac
      fi
      ;;
    *)
      case "${PROMPT_COMMAND:-}" in
        *_terax_precmd*) ;;
        *) PROMPT_COMMAND="_terax_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
      esac
      ;;
  esac
  _terax_pc_finish_last

  # An attached ble.sh keeps its own copy of PROMPT_COMMAND, restores it before
  # every prompt and drops what was added behind its back, so the hook above
  # is never called and the host sees one OSC 7 at startup and nothing after.
  # Its own hook list survives that; `!=` adds an entry only once.
  if [ -n "${BLE_VERSION-}" ] && declare -F blehook >/dev/null 2>&1; then
    blehook PRECMD!=_terax_ble_precmd 2>/dev/null \
      || blehook PRECMD+=_terax_ble_precmd 2>/dev/null
  fi

  # Pre-exec marker via PS0 (bash 4.4+). PS0 is expanded just before a command
  # runs — cleaner than a DEBUG trap, which would clobber user traps and fire
  # on every command including inside PROMPT_COMMAND.
  if [ "${BASH_VERSINFO[0]:-0}" -gt 4 ] \
     || { [ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -ge 4 ]; }; then
    if [ -n "${TERAX_BLOCKS-}" ]; then
      # PS0 only expands, never executes: the arithmetic inside the array
      # subscript sets the seen flag while the unset array expands to nothing.
      PS0='\[\e]133;C\e\\\]${_terax_noop[$((_terax_block_seen=1))]-}'"${PS0:-}"
    else
      PS0='\[\e]133;C\e\\\]'"${PS0:-}"
    fi
  fi

  _terax_precmd
fi
:
