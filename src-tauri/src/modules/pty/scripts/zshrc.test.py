#!/usr/bin/env python3
"""Shell integration tests for the zsh scripts. Run: python3 zshrc.test.py

Drives a real zsh in a pty the way Terax spawns it (ZDOTDIR pointing at a copy
of these scripts) and checks the OSC 7 / OSC 133 stream and the ZDOTDIR
hand-off.
"""
import fcntl
import os
import pty
import re
import select
import shutil
import struct
import sys
import tempfile
import termios
import time

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
ZSH = shutil.which("zsh")
if ZSH is None:
    print("skip: zsh is not installed")
    sys.exit(0)

OSC = re.compile(rb"\x1b\](\d+)(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)")
failures = 0


def check(label, ok, detail=""):
    global failures
    if ok:
        print(f"ok   {label}")
    else:
        failures += 1
        print(f"FAIL {label} {detail}")


class Session:
    def __init__(self, files, blocks=False, env=None):
        self.tmp = tempfile.mkdtemp(prefix="terax-zsh-test-")
        self.home = os.path.join(self.tmp, "home")
        self.zdotdir = os.path.join(self.tmp, "integration")
        os.makedirs(self.home)
        os.makedirs(self.zdotdir)
        for src, dst in (
            ("zshenv.zsh", ".zshenv"),
            ("zprofile.zsh", ".zprofile"),
            ("zshrc.zsh", ".zshrc"),
            ("zlogin.zsh", ".zlogin"),
        ):
            shutil.copy(os.path.join(SCRIPTS, src), os.path.join(self.zdotdir, dst))
        for rel, content in files.items():
            path = os.path.join(self.home, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as handle:
                handle.write(content.replace("@HOME@", self.home))
        child_env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": self.home,
            "TERM": "xterm-256color",
            "LANG": "C.UTF-8",
            "TERAX_TERMINAL": "1",
            "ZDOTDIR": self.zdotdir,
        }
        if blocks:
            child_env["TERAX_BLOCKS"] = "1"
        for key, value in (env or {}).items():
            child_env[key] = value.replace("@HOME@", self.home)
        self.out = b""
        pid, self.fd = pty.fork()
        if pid == 0:
            os.chdir(self.home)
            os.execve(ZSH, ["zsh", "-l"], child_env)
        self.pid = pid
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 120, 0, 0))
        self.wait_for_prompts(1)

    def prompts(self):
        return len(re.findall(rb"\x1b\]133;B", self.out))

    def pump(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            if select.select([self.fd], [], [], 0.05)[0]:
                try:
                    data = os.read(self.fd, 65536)
                except OSError:
                    return
                if not data:
                    return
                self.out += data

    def wait_for_prompts(self, count, timeout=8.0):
        end = time.time() + timeout
        while time.time() < end and self.prompts() < count:
            self.pump(0.05)
        self.pump(0.15)
        return self.prompts() >= count

    def run(self, line):
        before = self.prompts()
        os.write(self.fd, line.encode() + b"\r")
        return self.wait_for_prompts(before + 1)

    def close(self):
        try:
            os.write(self.fd, b"exit\r")
            self.pump(0.3)
            os.close(self.fd)
        except OSError:
            pass
        shutil.rmtree(self.tmp, ignore_errors=True)

    def events(self):
        """The stream as ("osc", number, arg) and ("text", str) tuples."""
        items, pos = [], 0
        for match in OSC.finditer(self.out):
            if match.start() > pos:
                items.append(("text", self.out[pos : match.start()].decode("utf-8", "replace")))
            items.append(("osc", match.group(1).decode(), (match.group(2) or b"").decode()))
            pos = match.end()
        items.append(("text", self.out[pos:].decode("utf-8", "replace")))
        return items

    def marks(self):
        return [
            f"{n}:{a}" if n == "133" else n
            for kind, *rest in self.events()
            if kind == "osc"
            for n, a in [rest[:2]]
            if n in ("133", "7")
        ]

    def result(self, name):
        found = re.findall(rf"RESULT:{name}=([^:\r\n]*):", self.out.decode("utf-8", "replace"))
        found = [value for value in found if "$" not in value]
        return found[-1] if found else None


def prompt_text_between_a_and_b(session):
    """Text drawn between each prompt start and the matching prompt end."""
    texts, current = [], None
    for kind, *rest in session.events():
        if kind == "osc" and rest[0] == "133" and rest[1] == "A":
            current = ""
        elif kind == "osc" and rest[0] == "133" and rest[1].startswith("B"):
            if current is not None:
                texts.append(current)
            current = None
        elif kind == "text" and current is not None:
            current += rest[0]
    return texts


# --- the marker stream ------------------------------------------------------
s = Session({".zshrc": "PS1='PROMPT> '\n"})
s.run("true")
s.run("false")
marks = s.marks()
check("a command is bracketed by C and D with its status", "133:C;false" in marks and "133:D;1" in marks, marks)
check("every prompt starts with A and ends with B", marks.count("133:A") == marks.count("133:B"), marks)
check("prompt text sits between A and B", all("PROMPT> " in text for text in prompt_text_between_a_and_b(s)), prompt_text_between_a_and_b(s))
s.run("cd /tmp")
check("the new cwd is reported after cd", re.search(rb"\x1b\]7;file://[^/]*/(private/)?tmp\x1b", s.out) is not None)
s.close()

# A prompt framework that rebuilds PS1 in a precmd running after ours, the way
# powerlevel10k keeps its hook last, must still end up with a prompt end after
# its prompt text on every prompt.
late = """
late_prompt() {
  PS1='late> '
  precmd_functions=(${precmd_functions:#late_prompt} late_prompt)
}
precmd_functions+=(late_prompt)
"""
s = Session({".zshrc": late})
s.run("true")
s.run("true")
texts = prompt_text_between_a_and_b(s)
check("a framework that rebuilds PS1 last still gets a prompt end", len(texts) >= 3 and all("late> " in text for text in texts), texts)
check("exactly one prompt end per prompt", s.marks().count("133:A") == s.marks().count("133:B"), s.marks())
s.close()

# A prompt that already carries its own end marker is not marked twice.
own = "PS1=$'PROMPT> %{\\e]133;B\\a%}'\n"
s = Session({".zshrc": own})
s.run("true")
check("a prompt with its own end marker is left alone", s.marks().count("133:A") == s.marks().count("133:B"), s.marks())
s.close()

# Block mode: the shell prompt is suppressed, only the markers remain.
s = Session({".zshrc": "PS1='PROMPT> '\n"}, blocks=True)
s.run("true")
check("block mode draws no shell prompt", "PROMPT> " not in s.out.decode("utf-8", "replace"))
check("block mode still ends the prompt", s.marks().count("133:B") >= 2)
s.close()

# User options that change how zsh reads arrays and unset variables must not
# break the integration.
s = Session({".zshrc": "PS1='PROMPT> '\nsetopt ksharrays nounset\n"})
s.run("true")
s.run("false")
text = s.out.decode("utf-8", "replace")
check("KSH_ARRAYS and NO_UNSET do not break the markers", s.marks().count("133:B") >= 3 and "133:D;1" in s.marks(), s.marks())
check("no parameter errors under those options", "parameter not set" not in text and "bad math" not in text, text[-200:])
s.close()

# --- ZDOTDIR ----------------------------------------------------------------
# ZDOTDIR has two faces: at the prompt and in hooks it is the user's own (the
# user's rc registers a precmd hook that records it), while a running command
# sees Terax's directory exported so a shell it starts is integrated again.
hook = "_probe() { PROBE_ZD=${ZDOTDIR-unset} }\nprecmd_functions+=(_probe)\n"
probe = (
    'print -r -- "RESULT:ZD=${PROBE_ZD-none}:"; print -r -- "RESULT:LOADED=${A_LOADED-no}:"; '
    'print -r -- "RESULT:HIST=${HISTFILE-none}:"; print -r -- "RESULT:USERVAR=${TERAX_USER_ZDOTDIR-unset}:"; '
    'print -r -- "RESULT:CMDZD=${ZDOTDIR-unset}:"; '
    "print -r -- \"RESULT:ENVZD=$(command env | sed -n 's/^ZDOTDIR=//p'):\""
)
loader = (
    'for file in "${ZDOTDIR:-$HOME/.config/zsh}/conf.d/"*.zsh; do\n'
    '  [ -r "$file" ] && source "$file"\n'
    "done\n"
)

# The user keeps their dotfiles in $ZDOTDIR, exported before zsh starts.
s = Session(
    {
        ".config/zsh/.zshenv": loader,
        ".config/zsh/conf.d/a.zsh": "A_LOADED=yes\n",
        ".config/zsh/.zshrc": "PS1='PROMPT> '\n" + hook,
    },
    env={"TERAX_USER_ZDOTDIR": "@HOME@/.config/zsh"},
)
s.run(probe)
text = s.out.decode("utf-8", "replace")
user_dir = os.path.join(s.home, ".config/zsh")
check("a $ZDOTDIR/conf.d loader in .zshenv finds the user's files", s.result("LOADED") == "yes", s.result("LOADED"))
check("no glob error from a $ZDOTDIR loader", "no matches found" not in text)
check("hooks and the prompt see the user's ZDOTDIR", s.result("ZD") == user_dir, s.result("ZD"))
check("a running command has the integration directory exported", s.result("ENVZD") == s.zdotdir and s.result("CMDZD") == s.zdotdir, (s.result("ENVZD"), s.result("CMDZD")))
check("history is not kept in the integration directory", (s.result("HIST") or "").startswith(s.home) or s.result("HIST") in (None, "none"), s.result("HIST"))
check("the integration still reports prompts", s.marks().count("133:B") >= 2)
check("the user's ZDOTDIR travels to child shells", s.result("USERVAR") == user_dir, s.result("USERVAR"))
s.close()

# The user sets ZDOTDIR from ~/.zshenv. zsh would continue with their files and
# skip ours if that value were left in place.
s = Session(
    {
        ".zshenv": 'export ZDOTDIR="@HOME@/.config/zsh"\n',
        ".config/zsh/.zshrc": "PS1='PROMPT> '\nA_LOADED=from-user-rc\n" + hook,
    }
)
s.run(probe)
check("a ZDOTDIR set by .zshenv still loads the user's .zshrc", s.result("LOADED") == "from-user-rc", s.result("LOADED"))
check("a ZDOTDIR set by .zshenv does not skip the integration", s.marks().count("133:B") >= 2, s.marks())
check("that ZDOTDIR is what the prompt sees", s.result("ZD") == os.path.join(s.home, ".config/zsh"), s.result("ZD"))
s.close()

# No ZDOTDIR at all: the prompt must not see one, a running command does.
s = Session({".zshrc": "PS1='PROMPT> '\n" + hook})
s.run(probe)
check("without a user ZDOTDIR the prompt sees none", s.result("ZD") == "unset", s.result("ZD"))
check("without a user ZDOTDIR a running command still hands children the integration", s.result("ENVZD") == s.zdotdir, s.result("ENVZD"))
check("without a user ZDOTDIR no user variable is exported", s.result("USERVAR") == "unset", s.result("USERVAR"))
s.close()

# exec zsh, a nested zsh and zsh -l regain the integration, and read the user's
# files exactly once per shell.
for label, user_zdotdir in (("with a user ZDOTDIR", True), ("without a user ZDOTDIR", False)):
    rc = "PS1='PROMPT> '\nprint start >> \"$HOME/rc.log\"\n" + hook
    files = {".zshenv": "print env >> \"$HOME/env.log\"\n"}
    env = None
    if user_zdotdir:
        files = {".config/zsh/.zshrc": rc, ".config/zsh/.zshenv": files[".zshenv"]}
        env = {"TERAX_USER_ZDOTDIR": "@HOME@/.config/zsh"}
    else:
        files[".zshrc"] = rc
    s = Session(files, env=env)
    wanted = os.path.join(s.home, ".config/zsh") if user_zdotdir else "unset"
    for command in ("exec zsh -l", "zsh", "zsh -l", "exec zsh"):
        before = s.prompts()
        ok = s.run(command)
        s.run(probe)
        check(f"{label}: `{command}` gets a prompt", ok and s.prompts() > before)
        check(f"{label}: `{command}` is integrated again", s.marks()[-12:].count("133:B") >= 1 and "133:A" in s.marks()[-12:], s.marks()[-12:])
        check(f"{label}: `{command}` sees the user's ZDOTDIR at its prompt", s.result("ZD") == wanted, s.result("ZD"))
        if command.startswith("zsh"):
            s.run("exit")
    shells = open(os.path.join(s.home, "rc.log")).read().count("start") if os.path.exists(os.path.join(s.home, "rc.log")) else 0
    envs = open(os.path.join(s.home, "env.log")).read().count("env") if os.path.exists(os.path.join(s.home, "env.log")) else 0
    check(f"{label}: the user's .zshrc ran once per shell (first, exec, 2 nested, exec)", shells == 5, shells)
    check(f"{label}: the user's .zshenv ran once per shell", envs == 5, envs)
    s.close()

# The implicit end of a command: exec zsh sends C and then the new shell's first
# precmd, which reports D for the command that no longer exists.
s = Session({".zshrc": "PS1='PROMPT> '\n"})
s.run("exec zsh -l")
marks = s.marks()
check("exec zsh reports C then a fresh D, A, B", "133:C;exec zsh -l" in marks and marks[marks.index("133:C;exec zsh -l") :].count("133:A") >= 1, marks)
s.close()

# The user's .zlogin is read from their own directory.
s = Session(
    {".zshrc": "PS1='PROMPT> '\n", ".zlogin": "A_LOADED=from-zlogin\n"},
)
s.run(probe)
check("the user's .zlogin runs", s.result("LOADED") == "from-zlogin", s.result("LOADED"))
s.close()

sys.exit(1 if failures else 0)
