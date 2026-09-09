import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.skipIf(process.platform === "win32")(
  "keeps Bash usable with and without PS0 integration",
  () => {
    const script = fileURLToPath(
      new URL(
        "../../../../src-tauri/src/modules/pty/scripts/bashrc.bash",
        import.meta.url,
      ),
    );
    const result = spawnSync(
      process.platform === "darwin" ? "/bin/bash" : "bash",
      [
        "--noprofile",
        "--norc",
        "-c",
        `
source() { :; }
export TERAX_BLOCKS=1
PS1='test> '
. "$1" >/dev/null
if (( BASH_VERSINFO[0] > 4 || BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 )); then
  test "$TERAX_BLOCKS" = 1 || exit 10
  case "$PS0" in *'133;C'*) ;; *) exit 11 ;; esac
else
  test -z "$TERAX_BLOCKS" || exit 12
  case "$PS1" in *'terax_blocks=0'*'test> '*) ;; *) exit 13 ;; esac
fi
`,
        "terax-test",
        script,
      ],
      {
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        encoding: "utf8",
        timeout: 5000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  },
);
