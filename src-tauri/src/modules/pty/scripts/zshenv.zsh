# terax-shell-integration (zshenv)
#
# Trailing `:` is load-bearing — without it, a missing user .zshenv leaves $?=1,
# which propagates through the rest of init and ultimately into the first
# prompt's `%?` (rendering robbyrussell's `➜` red on a clean shell start).
{
  _terax_wrapper_zdotdir="${ZDOTDIR:-}"
  _terax_had_wrapper_zdotdir=0
  [ -n "${ZDOTDIR+x}" ] && _terax_had_wrapper_zdotdir=1
  _terax_wrapper_default_histfile=""
  [ -n "$_terax_wrapper_zdotdir" ] && _terax_wrapper_default_histfile="$_terax_wrapper_zdotdir/.zsh_history"

  if [ -n "${TERAX_USER_ZDOTDIR+x}" ]; then
    export ZDOTDIR="$TERAX_USER_ZDOTDIR"
  else
    unset ZDOTDIR
  fi

  _terax_user_zdotdir="${ZDOTDIR:-$HOME}"
  if [ -n "$_terax_wrapper_default_histfile" ] && [ "${HISTFILE:-}" = "$_terax_wrapper_default_histfile" ]; then
    HISTFILE="$_terax_user_zdotdir/.zsh_history"
  fi
  [ -f "$_terax_user_zdotdir/.zshenv" ] && source "$_terax_user_zdotdir/.zshenv"

  if [ -n "${ZDOTDIR+x}" ]; then
    export TERAX_USER_ZDOTDIR="$ZDOTDIR"
  else
    unset TERAX_USER_ZDOTDIR
  fi

  if [ "$_terax_had_wrapper_zdotdir" = 1 ]; then
    export ZDOTDIR="$_terax_wrapper_zdotdir"
  else
    unset ZDOTDIR
  fi
  unset _terax_wrapper_zdotdir _terax_had_wrapper_zdotdir _terax_wrapper_default_histfile _terax_user_zdotdir
}
:
