set -gx TERAX_TERMINAL 1

function fish_prompt
    printf base
end

source (path dirname (status filename))/init.fish

# Conda preserves the prompt installed from conf.d before wrapping it.
functions -c fish_prompt __fish_prompt_orig
function fish_prompt
    printf conda
    __fish_prompt_orig
end

__terax_install_prompt

set -l rendered (fish_prompt)
test (string match -ra conda -- "$rendered" | count) -eq 1; or exit 1
test (string match -ra base -- "$rendered" | count) -eq 1; or exit 1

# Replacements that do not preserve Terax still need the post-config rewrap.
functions -e __fish_prompt_orig __terax_user_prompt fish_prompt
set -e __TERAX_HOOKS_LOADED
function fish_prompt
    printf base
end
source (path dirname (status filename))/init.fish
function fish_prompt
    printf replacement
end
__terax_install_prompt
set rendered (fish_prompt)
test (string match -ra replacement -- "$rendered" | count) -eq 1; or exit 1
string match -q '*]133;A*' -- "$rendered"; or exit 1
