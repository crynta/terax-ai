# terax-shell-integration (zprofile)
#
# See zshenv.zsh for how ZDOTDIR is handled and the rationale on the trailing `:`.
{
  _terax_zdotdir="$ZDOTDIR"
  _terax_user_zdotdir="${TERAX_USER_ZDOTDIR:-$HOME}"
  ZDOTDIR="$_terax_user_zdotdir"
  [ -f "$_terax_user_zdotdir/.zprofile" ] && source "$_terax_user_zdotdir/.zprofile"
  if [[ "${ZDOTDIR-}" != "$_terax_user_zdotdir" || -n "${TERAX_USER_ZDOTDIR-}" ]]; then
    export TERAX_USER_ZDOTDIR="${ZDOTDIR:-$HOME}"
  fi
  ZDOTDIR="$_terax_zdotdir"
  unset _terax_zdotdir _terax_user_zdotdir
}

if [[ "$OSTYPE" == "darwin"* ]]; then
  if [[ -x /opt/homebrew/bin/brew ]] && [[ ":$PATH:" != *":/opt/homebrew/bin:"* ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]] && [[ ":$PATH:" != *":/usr/local/bin:"* ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi
:
