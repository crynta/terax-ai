# terax-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _terax_user_zdotdir="${TERAX_USER_ZDOTDIR:-$HOME}"
  [ -f "$_terax_user_zdotdir/.zprofile" ] && source "$_terax_user_zdotdir/.zprofile"
  unset _terax_user_zdotdir
}

if [[ "$OSTYPE" == "darwin"* ]]; then
  if [[ -x /opt/homebrew/bin/brew ]] && [[ ":$PATH:" != *":/opt/homebrew/bin:"* ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]] && [[ ":$PATH:" != *":/usr/local/bin:"* ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi
:
