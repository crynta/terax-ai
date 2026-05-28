# terax-shell-integration (img) — iTerm inline image protocol (PNG, JPEG, GIF first frame).
if [ -n "$TERAX_TERMINAL" ] && [ -z "$__TERAX_MEDIA_LOADED" ]; then
  __TERAX_MEDIA_LOADED=1
  img() {
    local file="${1:?usage: img <path>}"
    [ -f "$file" ] || { echo "img: not found: $file" >&2; return 1; }
    printf '\033]1337;File=inline=1:%s\a' "$(base64 < "$file" | tr -d '\n')"
  }
fi
