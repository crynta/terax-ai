# terax-shell-integration (zshenv)
#
# Trailing `:` is load-bearing — without it, a missing user .zshenv leaves $?=1,
# which propagates through the rest of init and ultimately into the first
# prompt's `%?` (rendering robbyrussell's `➜` red on a clean shell start).
#
# $ZDOTDIR is swapped to the user's real config dir for the duration of the
# sourced file. User configs commonly resolve paths via $ZDOTDIR (e.g.
# `$ZDOTDIR/conf.d/*.zsh`); without the swap those globs land in the Terax
# integration dir and zsh errors with `no matches found` (#526). Restored
# afterwards so the next init phase still loads from the integration dir.
{
  _terax_user_zdotdir="${TERAX_USER_ZDOTDIR:-$HOME}"
  if [ -f "$_terax_user_zdotdir/.zshenv" ]; then
    _terax_saved_zdotdir="$ZDOTDIR"
    ZDOTDIR="$_terax_user_zdotdir"
    source "$_terax_user_zdotdir/.zshenv"
    ZDOTDIR="$_terax_saved_zdotdir"
    unset _terax_saved_zdotdir
  fi
  unset _terax_user_zdotdir
}
:
