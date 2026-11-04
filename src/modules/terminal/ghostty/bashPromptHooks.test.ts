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

it.skipIf(!existsSync(bash)).each(["scalar", "array", "empty", "registered"])(
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
  registered) PROMPT_COMMAND=('first' '_terax_precmd' 'second') ;;
esac
`;
    const verify = `
if [ "$1" = scalar ]; then
  test "$PROMPT_COMMAND" = '_terax_precmd;first;second' || exit 10
  actual=$(eval "$PROMPT_COMMAND")
else
  case "$(declare -p PROMPT_COMMAND)" in 'declare -a'*) ;; *) exit 11 ;; esac
  if [ "$1" = registered ]; then
    test "\${PROMPT_COMMAND[0]}" = first || exit 12
    test "\${PROMPT_COMMAND[1]}" = _terax_precmd || exit 19
  else
    test "\${PROMPT_COMMAND[0]}" = _terax_precmd || exit 12
  fi
  if [ "$1" = empty ]; then
    test "\${#PROMPT_COMMAND[@]}" = 1 || exit 13
  else
    test "\${#PROMPT_COMMAND[@]}" = 3 || exit 14
    if [ "$1" != registered ]; then
      test "\${PROMPT_COMMAND[1]}" = first || exit 15
    fi
    test "\${PROMPT_COMMAND[2]}" = second || exit 16
  fi
  actual=$(for hook in "\${PROMPT_COMMAND[@]}"; do eval "$hook"; done)
fi
case "$actual" in *']7;file://'*']133;A'*) ;; *) exit 17 ;; esac
if [ "$1" != empty ]; then
  case "$actual" in *first*second) ;; *) exit 18 ;; esac
fi
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
    expect(result.status).toBe(0);
  },
);
