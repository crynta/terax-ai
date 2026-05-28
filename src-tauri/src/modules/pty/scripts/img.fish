# terax-shell-integration (img) — iTerm inline image protocol (PNG, JPEG, GIF first frame).
if set -q TERAX_TERMINAL
    if not set -q __TERAX_MEDIA_LOADED
        set -g __TERAX_MEDIA_LOADED 1
        function img
            set -l file $argv[1]
            if test -z "$file"
                echo "usage: img <path>" >&2
                return 1
            end
            if not test -f "$file"
                echo "img: not found: $file" >&2
                return 1
            end
            set -l b64 (base64 < "$file" | string replace -a '\n' '')
            printf '\033]1337;File=inline=1:%s\a' "$b64"
        end
    end
end
