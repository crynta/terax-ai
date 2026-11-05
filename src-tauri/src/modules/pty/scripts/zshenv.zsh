# terax-shell-integration (zshenv)
#
# Terax points ZDOTDIR at its integration directory so zsh reads these wrappers
# first. The user's files are sourced with ZDOTDIR switched back to their own
# directory, so `$ZDOTDIR/conf.d/*.zsh` style loaders resolve where they expect.
# A ZDOTDIR the user's .zshenv sets itself is remembered in TERAX_USER_ZDOTDIR,
# otherwise zsh would continue with their .zshrc and skip ours.
#
# Trailing `:` is load-bearing — without it, a missing user .zshenv leaves $?=1,
# which propagates through the rest of init and ultimately into the first
# prompt's `%?` (rendering robbyrussell's `➜` red on a clean shell start).
{
  _terax_zdotdir="$ZDOTDIR"
  _terax_assigned="${TERAX_USER_ZDOTDIR:-$HOME}"
  ZDOTDIR="$_terax_assigned"
  [ -f "$_terax_assigned/.zshenv" ] && source "$_terax_assigned/.zshenv"
  if [[ "${ZDOTDIR-}" != "$_terax_assigned" || -n "${TERAX_USER_ZDOTDIR-}" ]]; then
    export TERAX_USER_ZDOTDIR="${ZDOTDIR:-$HOME}"
  fi
  # An interactive shell goes on to our .zprofile and .zshrc; a script or
  # `zsh -c` reads nothing else, so it keeps the user's own ZDOTDIR.
  if [[ -o interactive ]]; then
    ZDOTDIR="$_terax_zdotdir"
  elif [[ -n "${TERAX_USER_ZDOTDIR-}" ]]; then
    ZDOTDIR="$TERAX_USER_ZDOTDIR"
  else
    unset ZDOTDIR
  fi
  unset _terax_zdotdir _terax_assigned
}
:
