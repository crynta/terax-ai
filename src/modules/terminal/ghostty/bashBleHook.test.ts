import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const bash = "/bin/bash";
const integration = readFileSync(
  new URL(
    "../../../../src-tauri/src/modules/pty/scripts/bashrc.bash",
    import.meta.url,
  ),
  "utf8",
).replace(/\r\n/g, "\n");

/**
 * ble.sh snapshots PROMPT_COMMAND at attach time, restores its own copy
 * before every prompt and drops whatever was appended behind its back, so a
 * plain PROMPT_COMMAND hook never runs under it. The integration registers
 * `_terax_ble_precmd` on ble.sh's own PRECMD list instead (issue #1411); this
 * drives the real rcfile against a stub that reproduces exactly that restore
 * behavior and counts the OSC 7 cwd reports across `cd`s.
 */
function runWithBle(attached: boolean): string {
  const fixture = `
source() { :; }
myhook() { :; }
PROMPT_COMMAND='myhook'
_ble_precmd_hooks=()
blehook() {
  # Note: the prefixes stay unquoted below. Quoting a literal that contains
  # += inside a case pattern trips a bash parser quirk (it reports an
  # unterminated quote), so PRECMD+=*) not the quoted form.
  case "$1" in
    PRECMD!=*) _fn="\${1#PRECMD!=}" ;;
    PRECMD+=*) _fn="\${1#PRECMD+=}" ;;
    *) return 1 ;;
  esac
  case " \${_ble_precmd_hooks[*]} " in *" $_fn "*) return 0 ;; esac
  _ble_precmd_hooks+=("$_fn")
}
${
  attached
    ? 'BLE_VERSION="0.4-stub"\n_ble_saved_pc="$PROMPT_COMMAND"'
    : '_ble_saved_pc="$PROMPT_COMMAND"'
}
_ble_prompt() {
  PROMPT_COMMAND="$_ble_saved_pc"
  for _h in "\${_ble_precmd_hooks[@]}"; do "$_h"; done
}
`;
  const driver = `
cd /etc
_ble_prompt
cd /usr
_ble_prompt
`;
  const result = spawnSync(bash, ["--noprofile", "--norc", "-s"], {
    input: `${fixture}\n${integration}\n${driver}`,
    encoding: "utf8",
    timeout: 10000,
    env: { PATH: "/usr/bin:/bin", HOME: "/tmp/terax-no-ble-home" },
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return result.stdout;
}

function osc7Paths(output: string): string[] {
  const paths: string[] = [];
  const pattern = /\]7;file:\/\/[^\u001b\\]*/g;
  for (const match of output.matchAll(pattern)) {
    const url = match[0].slice("]7;file://".length);
    paths.push(url.slice(url.indexOf("/")));
  }
  return paths;
}

it.skipIf(!existsSync(bash))("reports cwd across prompts under ble.sh", () => {
  const paths = osc7Paths(runWithBle(true));
  expect(paths).toContain("/etc");
  expect(paths).toContain("/usr");
});

it.skipIf(!existsSync(bash))(
  "emits only the spawn-dir report without ble.sh hooks",
  () => {
    const paths = osc7Paths(runWithBle(false));
    expect(paths.length).toBe(1);
  },
);
