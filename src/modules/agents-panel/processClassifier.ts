export type ProcessInfo = {
  ptyId: number;
  pid: number;
  parentPid: number | null;
  name: string;
  command: string;
};

export type ProcessKind =
  | "agent"
  | "node"
  | "python"
  | "rust"
  | "c"
  | "shell"
  | "git"
  | "system"
  | "binary";

export type ClassifiedProcess = ProcessInfo & {
  kind: ProcessKind;
  label: string;
  detail: string;
};

const AGENTS = /\b(claude|codex|gemini|opencode)\b/i;
const NODE = /\b(node|npm|pnpm|yarn|bun|deno|vite|tsx|ts-node|next|astro)\b/i;
const PYTHON = /\b(python\d*|uv|poetry|pip|pytest|ipython|jupyter)\b/i;
const RUST = /\b(rustc|cargo|rust-analyzer|clippy|rustfmt)\b/i;
const C_FAMILY =
  /\b(clang\+\+|clang|gcc|g\+\+|cc|c\+\+|cmake|make|ninja|lldb|gdb)\b/i;
const SHELL = /\b(zsh|bash|fish|sh|pwsh|powershell|cmd\.exe|tmux|screen)\b/i;
const GIT = /\b(git|gh)\b/i;
const SYSTEM =
  /\b(kernel|launchd|systemd|loginwindow|WindowServer|CoreServices|com\.apple|svchost|explorer\.exe)\b/i;

export function classifyProcess(process: ProcessInfo): ClassifiedProcess {
  const haystack = `${process.name} ${process.command}`;
  if (AGENTS.test(haystack)) {
    return describe(process, "agent", "Agent", "coding agent process");
  }
  if (NODE.test(haystack)) {
    return describe(
      process,
      "node",
      "Node",
      "JavaScript or TypeScript runtime",
    );
  }
  if (PYTHON.test(haystack)) {
    return describe(process, "python", "Python", "Python runtime or tooling");
  }
  if (RUST.test(haystack)) {
    return describe(process, "rust", "Rust", "Rust toolchain process");
  }
  if (C_FAMILY.test(haystack)) {
    return describe(process, "c", "C/C++", "native compiler or build tool");
  }
  if (SHELL.test(haystack)) {
    return describe(
      process,
      "shell",
      "Shell",
      "interactive shell or multiplexer",
    );
  }
  if (GIT.test(haystack)) {
    return describe(process, "git", "Git", "source control process");
  }
  if (SYSTEM.test(haystack)) {
    return describe(process, "system", "System", "operating system process");
  }
  return describe(
    process,
    "binary",
    "Binary",
    "native executable or app process",
  );
}

function describe(
  process: ProcessInfo,
  kind: ProcessKind,
  label: string,
  detail: string,
): ClassifiedProcess {
  return { ...process, kind, label, detail };
}

export function visibleCommand(process: ProcessInfo): string {
  const command = process.command.trim() || process.name;
  return command.length > 160 ? `${command.slice(0, 157)}...` : command;
}
