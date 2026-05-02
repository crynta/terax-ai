# terax-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _terax_user_zdotdir="${TERAX_USER_ZDOTDIR:-$HOME}"
  [ -f "$_terax_user_zdotdir/.zprofile" ] && source "$_terax_user_zdotdir/.zprofile"
  unset _terax_user_zdotdir
}
:
