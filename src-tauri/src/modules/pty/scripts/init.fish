# terax-shell-integration (fish)
# Emits OSC 7 (cwd) + OSC 133 A/B/C/D so the host tracks cwd and prompt
# boundaries without re-parsing the prompt.

if set -q __TERAX_HOOKS_LOADED
    exit 0
end
set -g __TERAX_HOOKS_LOADED 1

set -g __TERAX_HOST (uname -n 2>/dev/null; or echo localhost)

# URL-encode a path keeping `/` intact so it stays valid inside file://.
function __terax_urlencode_path
    set -l parts (string split '/' -- $argv[1])
    set -l out
    for p in $parts
        if test -n "$p"
            set out $out (string escape --style=url -- $p)
        else
            set out $out ""
        end
    end
    string join '/' $out
end

function __terax_restore_status
    return $argv[1]
end

if functions -q fish_prompt
    functions -c fish_prompt __terax_user_prompt
end

function fish_prompt
    set -l __terax_status $status
    printf '\e]133;D;%d\e\\' $__terax_status
    printf '\e]7;file://%s%s\e\\' "$__TERAX_HOST" (__terax_urlencode_path "$PWD")
    printf '\e]133;A\e\\'
    __terax_restore_status $__terax_status
    if functions -q __terax_user_prompt
        __terax_user_prompt
    else
        printf '%s > ' (prompt_pwd)
    end
    printf '\e]133;B\e\\'
end

function __terax_preexec --on-event fish_preexec
    printf '\e]133;C\e\\'
end
