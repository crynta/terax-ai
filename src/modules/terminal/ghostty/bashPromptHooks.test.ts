import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const windowsBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" ? windowsBash : "/bin/bash";
const integration = readFileSync(
  new URL(
    "../../../../src-tauri/src/modules/pty/scripts/bashrc.bash",
    import.meta.url,
  ),
  "utf8",
).replace(/\r\n/g, "\n");

it
  .skipIf(!existsSync(bash))
  .each(["scalar", "array", "empty", "single", "sparse", "registered"])(
  "preserves Bash prompt hooks (%s)",
  (mode) => {
    const fixture = `
source() { :; }
first() { printf first; }
second() { printf second; }
PS1='test> '
case "$1" in
  scalar) PROMPT_COMMAND='first;second' ;;
  array) PROMPT_COMMAND=('first' 'second') ;;
  empty) PROMPT_COMMAND=() ;;
  single) PROMPT_COMMAND=('first') ;;
  sparse) PROMPT_COMMAND=([0]='first' [3]='second') ;;
  registered) PROMPT_COMMAND=('first' '_terax_precmd' 'second') ;;
esac
`;
    // From bash 5.1 every element of an array runs; before that only element 0.
    const verify = `
if (( BASH_VERSINFO[0] > 5 || BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1 )); then
  elements=1
else
  elements=
fi
case "$(declare -p PROMPT_COMMAND)" in
  'declare -a'*)
    if [ -n "$elements" ]; then
      actual=$(for hook in "\${PROMPT_COMMAND[@]}"; do eval "$hook"; done)
      test "\${PROMPT_COMMAND[\${#PROMPT_COMMAND[@]}-1]}" = _terax_finish_prompt || exit 11
      test "\${PROMPT_COMMAND[0]}" = _terax_precmd -o "$1" = registered || exit 12
    else
      actual=$(eval "\${PROMPT_COMMAND[0]}")
    fi
    ;;
  *)
    test "$1" = scalar || exit 13
    test "$PROMPT_COMMAND" = "_terax_precmd;first;second"$'\\n'"_terax_finish_prompt" || exit 14
    actual=$(eval "$PROMPT_COMMAND")
    ;;
esac
all="\${PROMPT_COMMAND[*]}"
stripped="\${all//_terax_precmd/}"
want=13
# Before 5.1 a hook parked in element 1 never ran, so element 0 gets its own.
if [ "$1" = registered ] && [ -z "$elements" ]; then want=26; fi
test "$(( \${#all} - \${#stripped} ))" = "$want" || exit 15
case "$actual" in *']7;file://'*']133;A'*) ;; *) exit 16 ;; esac
if [ "$1" != empty ]; then
  case "$actual" in *first*) ;; *) exit 17 ;; esac
  if [ "$1" != single ] && { [ "$1" = scalar ] || [ -n "$elements" ]; }; then
    case "$actual" in *first*second) ;; *) exit 18 ;; esac
  fi
fi
case "$PS1" in 'test> '*) ;; *) exit 19 ;; esac
`;
    const result = spawnSync(
      bash,
      ["--noprofile", "--norc", "-s", "--", mode],
      {
        input: `${fixture}\n${integration}\n${verify}`,
        encoding: "utf8",
        timeout: 10000,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
  },
);

it.skipIf(!existsSync(bash))(
  "puts the prompt end behind every PROMPT_COMMAND entry that rebuilds PS1",
  () => {
    const script = `
source() { :; }
fw() { PS1='fw> '; }
PROMPT_COMMAND=fw
${integration}
PS1=
eval "$PROMPT_COMMAND"
case "$PS1" in 'fw> '*'133;B'*) ;; *) exit 10 ;; esac
`;
    const result = spawnSync(bash, ["--noprofile", "--norc", "-s"], {
      input: script,
      encoding: "utf8",
      timeout: 10000,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  },
);
