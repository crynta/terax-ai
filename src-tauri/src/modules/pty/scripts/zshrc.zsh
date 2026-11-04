# terax-shell-integration (zshrc)
#
# Emits OSC 7 (cwd) + OSC 133 A/B/C/D (prompt-start / prompt-end / pre-exec /
# command-done-with-exit-code) so the host can detect command boundaries and
# track cwd without re-parsing the prompt. `status` is a read-only special in
# zsh, so we shadow $? into `_terax_ret`.

{
  # Terax's directory is still ZDOTDIR here (see zshenv.zsh). /etc/zshrc on
  # macOS derives HISTFILE from it, so move that to the user's directory.
  _terax_zdotdir="$ZDOTDIR"
  _terax_user_zdotdir="${TERAX_USER_ZDOTDIR:-$HOME}"
  if [[ -n "${HISTFILE-}" && "$HISTFILE" == "$_terax_zdotdir"/* ]]; then
    HISTFILE="$_terax_user_zdotdir/${HISTFILE:t}"
  fi
  ZDOTDIR="$_terax_user_zdotdir"
  [ -f "$_terax_user_zdotdir/.zshrc" ] && source "$_terax_user_zdotdir/.zshrc"
}

if [[ -n "$TERAX_CLI" && -x "$TERAX_CLI" ]]; then
  terax() {
    command "$TERAX_CLI" "$@"
  }
fi

# Re-source guard within a single shell (e.g. user runs `source ~/.zshrc`).
# This is NOT exported, so each nested zsh installs its own hooks — desired,
# since every interactive shell needs its own prompt integration.
if [[ -z "$__TERAX_HOOKS_LOADED" ]]; then
  __TERAX_HOOKS_LOADED=1
  autoload -Uz add-zsh-hook 2>/dev/null

  # URL-encode $1 byte-wise into REPLY so multi-byte paths stay valid in the
  # `file://` URI emitted via OSC 7. `no_multibyte` forces ${s[i]} to index
  # bytes (not code points), and LC_ALL=C keeps the [a-zA-Z0-9...] class
  # single-byte. No command substitution: a fork per prompt is pure latency.
  _terax_urlencode() {
    emulate -L zsh
    setopt localoptions no_multibyte
    local LC_ALL=C s="$1" i byte
    REPLY=
    for (( i=1; i<=${#s}; i++ )); do
      byte="${s[i]}"
      case "$byte" in
        [a-zA-Z0-9/._~-]) REPLY+="$byte" ;;
        *) printf -v byte '%%%02X' "'$byte"; REPLY+="$byte" ;;
      esac
    done
  }

  _terax_report_cwd() {
    if [[ "$PWD" == *[^a-zA-Z0-9/._~-]* ]]; then
      _terax_urlencode "$PWD"
    else
      REPLY="$PWD"
    fi
    printf '\e]7;file://%s%s\e\\' "${HOST}" "$REPLY"
  }

  # Prompt-end marker. Embedded in PS1 when nothing in the prompt carries one
  # already, so redraws (resize, reset-prompt) repeat it; the line-init hook
  # below covers prompts a framework builds itself.
  _terax_prompt_has_end() {
    [[ "$PS1" == *$'\e]133;B'* ]]
  }

  _terax_precmd() {
    local _terax_ret=$?
    printf '\e]133;D;%s\e\\' "$_terax_ret"
    _terax_report_cwd
    # In block mode the host renders its own input bar, so suppress the shell
    # prompt entirely (keep only the OSC 133 B marker) and add a leading blank
    # line so frozen command blocks get vertical breathing room.
    if [[ -n "$TERAX_BLOCKS" ]]; then
      # Spacing reserved for the host-drawn block header lives in the prompt
      # (the grid is WebGL, not CSS). Later prompts get two blank rows: the
      # upper one is the previous block's end gap (above its divider), the lower
      # one is this command's header row. The very first prompt has no block
      # above it, so it gets a single row (header only) to avoid a tall top gap.
      if [[ -n "$_terax_block_seen" ]]; then
        _terax_block_ps1=$'\n\n%{\e]133;B\e\\%}'
      else
        _terax_block_ps1=$'\n%{\e]133;B\e\\%}'
      fi
      PS1="$_terax_block_ps1"
      RPROMPT=''
    elif ! _terax_prompt_has_end; then
      PS1+=$'%{\e]133;B\e\\%}'
    fi
    _terax_end_pending=1
    _terax_ensure_line_init
    printf '\e]133;A\e\\'
  }

  # Runs once the line editor has drawn the prompt, so it lands after whatever
  # the prompt framework (powerlevel10k, starship, ...) rebuilt in its own
  # precmd or redrew asynchronously. A second marker at the same spot is
  # harmless, a missing one holds the prompt back until the host's fallback.
  _terax_line_init() {
    [[ -n "$_terax_end_pending" ]] || return 0
    _terax_end_pending=
    if [[ -n "$TERAX_BLOCKS" && -n "$_terax_block_ps1" && "$PS1" != "$_terax_block_ps1" ]]; then
      # A framework rebuilt the prompt after our precmd (powerlevel10k runs
      # last): the host draws the input bar, so take the shell prompt back.
      PS1="$_terax_block_ps1"
      RPROMPT=''
      zle reset-prompt
    fi
    _terax_prompt_has_end || printf '\e]133;B\e\\'
    return 0
  }

  _terax_ensure_line_init() {
    [[ "${widgets[zle-line-init]-}" == user:azhw:zle-line-init ]] && return 0
    if [[ "$ZSH_VERSION" == (5.<3->*|<6->.*) ]]; then
      autoload -Uz add-zle-hook-widget
      add-zle-hook-widget line-init _terax_line_init
    else
      # zsh < 5.3 has no hook widgets: chain the existing widget by hand.
      [[ "${widgets[zle-line-init]-}" == user:_terax_line_init_chain ]] && return 0
      (( $+widgets[zle-line-init] )) && zle -A zle-line-init _terax_line_init_prev
      _terax_line_init_chain() {
        (( $+widgets[_terax_line_init_prev] )) && zle _terax_line_init_prev "$@"
        _terax_line_init
      }
      zle -N zle-line-init _terax_line_init_chain
    fi
  }

  _terax_preexec() {
    # Mark that a real command ran, so the next prompt switches from one blank
    # row (first prompt, no block above) to two (end gap + header row).
    [[ -n "$TERAX_BLOCKS" ]] && _terax_block_seen=1
    local cmd="${1//[[:cntrl:]]/ }"
    printf '\e]133;C;%s\e\\' "${cmd[1,256]}"
  }

  if (( $+functions[add-zsh-hook] )); then
    add-zsh-hook precmd _terax_precmd
    add-zsh-hook preexec _terax_preexec
  fi

  # With POWERLEVEL9K_TERM_SHELL_INTEGRATION powerlevel10k emits its own C and
  # D, which would repeat ours (and carry no command line). Its A and B stay:
  # they live in the prompt and survive its asynchronous redraws.
  if (( $+functions[_p9k_iterm2_precmd] )); then
    functions[_p9k_iterm2_precmd]=':'
    functions[_p9k_iterm2_preexec]=':'
  fi

  # Warp/iTerm2-style word-end navigation: zsh's default `forward-word` (M-f /
  # Option+Right) overshoots to the START of the next word; `emacs-forward-word`
  # stops at the END of the current word, which is what nearly every other shell
  # and GUI editor does. Only rebind when the binding is still the stock zsh
  # default — respects any explicit remap in the user's .zshrc.
  if (( $+widgets[emacs-forward-word] )) \
     && [[ "$(bindkey '\ef')" == '"^[f" forward-word' ]]; then
    bindkey '\ef' emacs-forward-word
  fi

  # Report the starting directory before the first prompt; the first precmd
  # emits the prompt markers.
  _terax_report_cwd
fi

# Hand ZDOTDIR back: the interactive shell, its children and anything the user
# loads lazily must see their own value, and zsh then reads their .zlogin.
if [[ -z "${TERAX_USER_ZDOTDIR-}" && "${ZDOTDIR-}" == "$_terax_user_zdotdir" ]]; then
  unset ZDOTDIR
elif [[ "${ZDOTDIR-}" == "$_terax_zdotdir" ]]; then
  ZDOTDIR="$_terax_user_zdotdir"
fi
unset _terax_zdotdir _terax_user_zdotdir TERAX_USER_ZDOTDIR
:
