# terax-shell-integration (zshrc)
#
# Emits OSC 7 (cwd) + OSC 133 A/B/C/D (prompt-start / prompt-end / pre-exec /
# command-done-with-exit-code) so the host can detect command boundaries and
# track cwd without re-parsing the prompt. `status` is a read-only special in
# zsh, so we shadow $? into `_terax_ret`.

{
  _terax_user_zdotdir="${TERAX_USER_ZDOTDIR:-$HOME}"
  [ -f "$_terax_user_zdotdir/.zshrc" ] && source "$_terax_user_zdotdir/.zshrc"
  unset _terax_user_zdotdir
}

# Re-source guard within a single shell (e.g. user runs `source ~/.zshrc`).
# This is NOT exported, so each nested zsh installs its own hooks — desired,
# since every interactive shell needs its own prompt integration.
if [[ -z "$__TERAX_HOOKS_LOADED" ]]; then
  __TERAX_HOOKS_LOADED=1
  autoload -Uz add-zsh-hook 2>/dev/null

  # URL-encode $PWD byte-wise so multi-byte paths stay valid in the `file://`
  # URI emitted via OSC 7. `no_multibyte` forces ${s[i]} to index bytes (not
  # code points), and LC_ALL=C keeps the [a-zA-Z0-9...] class single-byte.
  _terax_urlencode() {
    emulate -L zsh
    setopt localoptions no_multibyte
    local LC_ALL=C s="$1" i byte
    for (( i=1; i<=${#s}; i++ )); do
      byte="${s[i]}"
      case "$byte" in
        [a-zA-Z0-9/._~-]) printf '%s' "$byte" ;;
        *) printf '%%%02X' "'$byte" ;;
      esac
    done
  }

  _terax_precmd() {
    local _terax_ret=$?
    printf '\e]133;D;%s\e\\' "$_terax_ret"
    printf '\e]7;file://%s%s\e\\' "${HOST}" "$(_terax_urlencode "$PWD")"
    # Re-inject prompt-end marker in case a framework rebuilt PS1 (p10k, starship).
    if [[ "$PS1" != *$'\e]133;B\e\\'* ]]; then
      PS1=$'%{\e]133;B\e\\%}'"$PS1"
    fi
    printf '\e]133;A\e\\'
  }

  _terax_preexec() {
    printf '\e]133;C\e\\'
  }

  if (( $+functions[add-zsh-hook] )); then
    add-zsh-hook precmd _terax_precmd
    add-zsh-hook preexec _terax_preexec
  fi

  # terax_open: open file in editor tab via OSC 8888.
  # Usage: terax_open <file>
  terax_open() {
    local file="$1"

    if [[ -z "$file" ]]; then
      printf "usage: terax_open <file>\n" >&2
      return 1
    fi

    # Resolve relative paths relative to PWD.
    if [[ "$file" != /* ]]; then
      file="$PWD/$file"
    fi

    # Check that the path exists and is a regular file.
    if [[ ! -f "$file" ]]; then
      printf "terax_open: not a file: %s\n" "$file" >&2
      return 1
    fi

    # Emit OSC 8888 with URL-encoded file path.
    printf '\e]8888;file=%s\e\\' "$(_terax_urlencode "$file")"
  }

  # terax-preview: open URL in a Terax preview tab via OSC 8888.
  # Usage: terax-preview <url>
  terax-preview() {
    local url="$1"
    if [[ -z "$url" ]]; then
      printf "usage: terax-preview <url>\n" >&2
      return 1
    fi
    printf '\e]8888;url=%s;target=preview\e\\' "$(_terax_urlencode "$url")"
  }

  # terax-open: preview-first URL opener for terminal-first workflows.
  # Usage: terax-open <url>
  terax-open() {
    terax-preview "$@"
  }

  # terax-open-browser: open URL in the local system browser via OSC 8888.
  # Usage: terax-open-browser <url>
  terax-open-browser() {
    local url="$1"
    if [[ -z "$url" ]]; then
      printf "usage: terax-open-browser <url>\n" >&2
      return 1
    fi
    printf '\e]8888;url=%s;target=browser\e\\' "$(_terax_urlencode "$url")"
  }

  # terax-remote-cwd: mark the current terminal as a remote workspace.
  # Usage: terax-remote-cwd ssh://host/path
  terax-remote-cwd() {
    local cwd="$1"
    if [[ "$cwd" != ssh://* ]]; then
      printf "usage: terax-remote-cwd ssh://host/path\n" >&2
      return 1
    fi
    printf '\e]8888;remote-cwd=%s\e\\' "$(_terax_urlencode "$cwd")"
  }

  # Shorthand alias.
  alias tp='terax_open'

  _terax_precmd
fi
:
