# terax-shell-integration (zshrc)
#
# Emits OSC 7 (cwd) + OSC 133 A/B/C/D (prompt-start / prompt-end / pre-exec /
# command-done-with-exit-code) so the host can detect command boundaries and
# track cwd without re-parsing the prompt. `status` is a read-only special in
# zsh, so we shadow $? into `_terax_ret`.
#
# Our own code runs under `emulate -L zsh` so user options (KSH_ARRAYS, NO_UNSET,
# ...) cannot break it; the user's files are sourced outside of it.

{
  # Terax's directory is still ZDOTDIR here (see zshenv.zsh). /etc/zshrc on
  # macOS derives HISTFILE from it, so move that to the user's directory.
  _terax_zdotdir="${ZDOTDIR-}"
  _terax_user_zdotdir="${TERAX_USER_ZDOTDIR:-${HOME-}}"
  if [[ -n "${HISTFILE-}" && "${HISTFILE-}" == "$_terax_zdotdir"/* ]]; then
    HISTFILE="$_terax_user_zdotdir/${HISTFILE:t}"
  fi
  ZDOTDIR="$_terax_user_zdotdir"
  [ -f "$_terax_user_zdotdir/.zshrc" ] && source "$_terax_user_zdotdir/.zshrc"
}

_terax_zshrc_setup() {
  emulate -L zsh

  if [[ -n "${TERAX_CLI-}" && -x "${TERAX_CLI-}" ]]; then
    terax() {
      command "$TERAX_CLI" "$@"
    }
  fi

  # Re-source guard within a single shell (e.g. user runs `source $ZDOTDIR/.zshrc`).
  # This is NOT exported, so each nested zsh installs its own hooks — desired,
  # since every interactive shell needs its own prompt integration.
  if [[ -n "${__TERAX_HOOKS_LOADED-}" ]]; then
    # Sourced again while a command runs: leave ZDOTDIR as it was found.
    if [[ -n "$_terax_zdotdir" ]]; then export ZDOTDIR="$_terax_zdotdir"; else unset ZDOTDIR; fi
    return 0
  fi
  __TERAX_HOOKS_LOADED=1
  autoload -Uz add-zsh-hook 2>/dev/null

  # ZDOTDIR has two faces. While a command runs it is exported as Terax's
  # directory, so a shell that command starts (exec zsh, a nested zsh, zsh -l)
  # reads the integration scripts again; at the prompt, in hooks and in widgets
  # it is the user's own value (or unset), so code that reads $ZDOTDIR lazily
  # finds their files. TERAX_USER_ZDOTDIR carries the user's value to children.
  _terax_zd_integration="$_terax_zdotdir"
  if [[ -n "${TERAX_USER_ZDOTDIR-}" || "${ZDOTDIR-}" != "$_terax_user_zdotdir" ]]; then
    _terax_zd_has_user=1
    _terax_zd_user="${ZDOTDIR:-$_terax_user_zdotdir}"
    export TERAX_USER_ZDOTDIR="$_terax_zd_user"
  else
    _terax_zd_has_user=
    unset TERAX_USER_ZDOTDIR
  fi

  _terax_zdotdir_prompt() {
    emulate -L zsh
    if [[ -n "$_terax_zd_has_user" ]]; then
      ZDOTDIR="$_terax_zd_user"
    else
      unset ZDOTDIR
    fi
  }

  # Whether a command line starts a zsh: the first word of any list or pipeline
  # segment, after the usual wrappers, is zsh, a path to it, or $SHELL when that
  # is zsh. Pure zsh word splitting, no forks; indirect launches (a function, a
  # script, tmux) are not seen and start without the integration.
  _terax_starts_zsh() {
    emulate -L zsh
    local -a words
    local word prefix= command_position=1 skip=
    local login_shell="${SHELL:t}"
    words=( ${(z)1} )
    for word in "${words[@]}"; do
      if [[ -n "$skip" ]]; then skip=; continue; fi
      case "$word" in
        ';'|'&'|'&&'|'|'|'||'|'|&'|'('|')'|'{'|'}'|'!'|then|do|else|elif|if|while|until)
          command_position=1; prefix=; continue ;;
      esac
      [[ -n "$command_position" ]] || continue
      word="${(Q)word}"
      case "$prefix" in
        env)
          case "$word" in
            -u|-C|-S) skip=1; continue ;;
            -*|*=*) continue ;;
          esac
          prefix=
          ;;
        sudo)
          case "$word" in
            -s|-i|--shell|--login)
              [[ "$login_shell" == zsh ]] && return 0
              continue ;;
            -u|-g|-h|-p|-C|-D|-R|-T|-U|-r|-t|-c) skip=1; continue ;;
            -*|*=*) continue ;;
          esac
          prefix=
          ;;
      esac
      case "$word" in
        exec|command|builtin|nocorrect|noglob|nohup|time|-|--) continue ;;
        env) prefix=env; continue ;;
        sudo|doas) prefix=sudo; continue ;;
        *=*) continue ;;
        su) [[ "$login_shell" == zsh ]] && return 0 ;;
        zsh|-zsh|*/zsh|*/-zsh) return 0 ;;
        '$SHELL'|'${SHELL}') [[ "$login_shell" == zsh ]] && return 0 ;;
      esac
      command_position=
    done
    return 1
  }

  # While a command runs ZDOTDIR stays the user's, so a typed `vim $ZDOTDIR/.zshrc`
  # expands to their file. Only a command line that starts a zsh exports
  # Terax's directory, so that shell reads the integration; the next precmd
  # puts the user's value back.
  _terax_zdotdir_command() {
    emulate -L zsh
    _terax_starts_zsh "${3-$1}" || return 0
    export ZDOTDIR="$_terax_zd_integration"
  }

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
    emulate -L zsh
    if [[ "$PWD" == *[^a-zA-Z0-9/._~-]* ]]; then
      _terax_urlencode "$PWD"
    else
      REPLY="$PWD"
    fi
    printf '\e]7;file://%s%s\e\\' "${HOST-}" "$REPLY"
  }

  # Prompt-end marker. Embedded in PS1 when nothing in the prompt carries one
  # already, so redraws (resize, reset-prompt) repeat it; the line-init hook
  # below covers prompts a framework builds itself.
  _terax_prompt_has_end() {
    emulate -L zsh
    [[ "${PS1-}" == *$'\e]133;B'* ]]
  }

  _terax_precmd() {
    local _terax_ret=$?
    emulate -L zsh
    printf '\e]133;D;%s\e\\' "$_terax_ret"
    _terax_report_cwd
    # In block mode the host renders its own input bar, so suppress the shell
    # prompt entirely (keep only the OSC 133 B marker) and add a leading blank
    # line so frozen command blocks get vertical breathing room.
    if [[ -n "${TERAX_BLOCKS-}" ]]; then
      # Spacing reserved for the host-drawn block header lives in the prompt
      # (the grid is WebGL, not CSS). Later prompts get two blank rows: the
      # upper one is the previous block's end gap (above its divider), the lower
      # one is this command's header row. The very first prompt has no block
      # above it, so it gets a single row (header only) to avoid a tall top gap.
      if [[ -n "${_terax_block_seen-}" ]]; then
        _terax_block_ps1=$'\n\n%{\e]133;B\e\\%}'
      else
        _terax_block_ps1=$'\n%{\e]133;B\e\\%}'
      fi
      PS1="$_terax_block_ps1"
      RPROMPT=''
    elif ! _terax_prompt_has_end; then
      PS1="${PS1-}"$'%{\e]133;B\e\\%}'
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
    emulate -L zsh
    [[ -n "${_terax_end_pending-}" ]] || return 0
    _terax_end_pending=
    if [[ -n "${TERAX_BLOCKS-}" && -n "${_terax_block_ps1-}" && "${PS1-}" != "$_terax_block_ps1" ]]; then
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
    emulate -L zsh
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
    emulate -L zsh
    # Mark that a real command ran, so the next prompt switches from one blank
    # row (first prompt, no block above) to two (end gap + header row).
    [[ -n "${TERAX_BLOCKS-}" ]] && _terax_block_seen=1
    local cmd="${1//[[:cntrl:]]/ }"
    printf '\e]133;C;%s\e\\' "${cmd[1,256]}"
  }

  if (( $+functions[add-zsh-hook] )); then
    add-zsh-hook precmd _terax_precmd
    add-zsh-hook preexec _terax_preexec
    add-zsh-hook precmd _terax_zdotdir_prompt
    precmd_functions=(_terax_zdotdir_prompt ${precmd_functions:#_terax_zdotdir_prompt})
    add-zsh-hook preexec _terax_zdotdir_command
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
  # emits the prompt markers. Then show the user their own ZDOTDIR, which is
  # also what zsh reads their .zlogin from.
  _terax_report_cwd
  _terax_zdotdir_prompt
}

_terax_zshrc_setup
unset -f _terax_zshrc_setup
unset _terax_zdotdir _terax_user_zdotdir
:
