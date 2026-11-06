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
:
