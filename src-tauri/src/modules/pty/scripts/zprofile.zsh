# terax-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:` and the ZDOTDIR swap.
{
  _terax_user_zdotdir="${TERAX_USER_ZDOTDIR:-$HOME}"
  if [ -f "$_terax_user_zdotdir/.zprofile" ]; then
    _terax_saved_zdotdir="$ZDOTDIR"
    ZDOTDIR="$_terax_user_zdotdir"
    source "$_terax_user_zdotdir/.zprofile"
    ZDOTDIR="$_terax_saved_zdotdir"
    unset _terax_saved_zdotdir
  fi
  unset _terax_user_zdotdir
}
:
