import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";

const SHELL_KEYWORDS = [
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "do",
  "done",
  "case",
  "esac",
  "in",
  "function",
  "select",
  "until",
  "return",
  "break",
  "continue",
  "export",
  "unset",
  "alias",
  "unalias",
  "source",
  "set",
  "local",
  "read",
] as const;

const SHELL_COMMANDS = [
  "cd",
  "ls",
  "pwd",
  "echo",
  "printf",
  "cat",
  "grep",
  "rg",
  "find",
  "fd",
  "awk",
  "sed",
  "sort",
  "uniq",
  "wc",
  "head",
  "tail",
  "less",
  "tee",
  "xargs",
  "cut",
  "tr",
  "diff",
  "touch",
  "mkdir",
  "rmdir",
  "rm",
  "cp",
  "mv",
  "ln",
  "chmod",
  "chown",
  "stat",
  "du",
  "df",
  "ps",
  "top",
  "htop",
  "kill",
  "jobs",
  "nohup",
  "env",
  "which",
  "man",
  "history",
  "clear",
  "exit",
  "ssh",
  "scp",
  "rsync",
  "curl",
  "wget",
  "ping",
  "tar",
  "gzip",
  "zip",
  "unzip",
  "make",
  "cmake",
  "gcc",
  "clang",
  "git",
  "gh",
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "deno",
  "python",
  "python3",
  "pip",
  "pip3",
  "cargo",
  "rustc",
  "rustup",
  "go",
  "docker",
  "kubectl",
  "helm",
  "terraform",
  "brew",
  "apt",
  "systemctl",
  "code",
  "vim",
  "nvim",
  "nano",
  "open",
  "claude",
  "codex",
  "gemini",
  "aider",
] as const;

const WORD_RE = /[\w./+-]*/;
const DOC_WORD_RE = /[A-Za-z_][\w./-]+/g;
const VALID_FOR = /^[\w./+-]*$/;
const SEGMENT_START = /(^|[\n;&|(){}])\s*$/;

export function shellCompletionOptions(
  prefix: string,
  doc = "",
): Completion[] {
  const lower = prefix.toLowerCase();
  const seen = new Set<string>();
  const options: Completion[] = [];

  for (const keyword of SHELL_KEYWORDS) {
    if (keyword.startsWith(lower)) addOption(options, seen, keyword, "keyword");
  }
  for (const command of SHELL_COMMANDS) {
    if (command.startsWith(lower)) addOption(options, seen, command, "function");
  }
  for (const match of doc.matchAll(DOC_WORD_RE)) {
    const word = match[0];
    if (word === prefix || !word.toLowerCase().startsWith(lower)) continue;
    addOption(options, seen, word, "text");
    if (options.length >= 80) break;
  }

  return options;
}

export function composerShellCompletionSource(
  ctx: CompletionContext,
): CompletionResult | null {
  const word = ctx.matchBefore(WORD_RE);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;

  const line = ctx.state.doc.lineAt(word.from);
  const before = ctx.state.doc.sliceString(line.from, word.from);
  const doc = ctx.state.doc.toString();
  const options = shellCompletionOptions(word.text, doc);

  if (options.length === 0) return null;
  return {
    from: word.from,
    options: SEGMENT_START.test(before)
      ? options
      : options.filter((option) => option.type !== "function"),
    validFor: VALID_FOR,
  };
}

function addOption(
  options: Completion[],
  seen: Set<string>,
  label: string,
  type: Completion["type"],
): void {
  if (seen.has(label)) return;
  seen.add(label);
  options.push({ label, type });
}
