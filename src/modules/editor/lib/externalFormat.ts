import { quoteShellArg } from "@/lib/shellQuote";
import type { EditorFormatter } from "@/modules/settings/store";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";

type ReadResult = { kind: string; content?: string };

type CommandOutput = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
};

export type ExternalFormatter = Exclude<EditorFormatter, "lsp">;

type FormatterDef = {
  label: string;
  /** In-place write command; the quoted file path is appended. */
  command: string;
  /** languageResolver ids the global default applies to; explicit
   * per-language overrides bypass this gate. */
  langs: readonly string[];
};

export const FORMATTERS: Record<
  Exclude<ExternalFormatter, "custom">,
  FormatterDef
> = {
  biome: {
    label: "Biome",
    command: "biome format --write",
    langs: ["js", "jsx", "ts", "tsx", "json", "css"],
  },
  prettier: {
    label: "Prettier",
    command: "prettier --write",
    langs: [
      "js",
      "jsx",
      "ts",
      "tsx",
      "json",
      "css",
      "html",
      "vue",
      "md",
      "yaml",
    ],
  },
  ruff: { label: "Ruff", command: "ruff format", langs: ["py"] },
  rustfmt: {
    label: "rustfmt",
    command: "rustfmt --edition 2021",
    langs: ["rs"],
  },
  gofmt: { label: "gofmt", command: "gofmt -w", langs: ["go"] },
  "clang-format": {
    label: "clang-format",
    command: "clang-format -i",
    langs: ["c", "h", "cpp", "cc", "hpp"],
  },
  shfmt: { label: "shfmt", command: "shfmt -w", langs: ["sh", "bash", "zsh"] },
  zigfmt: { label: "zig fmt", command: "zig fmt", langs: ["zig"] },
};

export const FORMATTER_LABELS: Record<EditorFormatter, string> = {
  lsp: "Language server",
  custom: "Custom command",
  ...Object.fromEntries(
    Object.entries(FORMATTERS).map(([id, def]) => [id, def.label]),
  ),
} as Record<EditorFormatter, string>;

type FormatterPrefs = {
  editorFormatter: EditorFormatter;
  editorFormatterByLang: Record<string, EditorFormatter>;
};

// Explicit overrides always win and always run. The global default only
// applies to languages its tool understands; anything else falls back to
// the language server so a global "biome" never chews on a .py file.
export function resolveFormatter(
  langId: string | null,
  prefs: FormatterPrefs,
): EditorFormatter {
  const override = langId ? prefs.editorFormatterByLang[langId] : undefined;
  if (override) return override;
  const global = prefs.editorFormatter;
  if (global === "lsp" || global === "custom") return global;
  return langId && FORMATTERS[global].langs.includes(langId) ? global : "lsp";
}

function dirname(path: string): string {
  const segs = path.split(/[\\/]/);
  segs.pop();
  return segs.join("/") || "/";
}

function buildCommand(
  formatter: ExternalFormatter,
  path: string,
  customTemplate: string,
): string | null {
  const quoted = quoteShellArg(path);
  if (formatter === "custom") {
    const template = customTemplate.trim();
    if (!template) return null;
    return template.includes("{file}")
      ? template.split("{file}").join(quoted)
      : `${template} ${quoted}`;
  }
  return `${FORMATTERS[formatter].command} ${quoted}`;
}

/** Returns null on success, an error message otherwise. */
export async function runExternalFormatter(
  formatter: ExternalFormatter,
  path: string,
  customTemplate = "",
): Promise<string | null> {
  const command = buildCommand(formatter, path, customTemplate);
  if (!command) {
    return "No custom format command configured in Settings.";
  }
  try {
    const out = await invoke<CommandOutput>("shell_run_command", {
      command,
      cwd: dirname(path),
      timeoutSecs: 20,
      workspace: currentWorkspaceEnv(),
    });
    if (out.timed_out) return `${formatter} timed out`;
    if (out.exit_code !== 0) {
      return out.stderr.trim().slice(-300) || `${formatter} failed`;
    }
    return null;
  } catch (e) {
    return String(e);
  }
}

export async function readFileText(path: string): Promise<string | null> {
  const res = await invoke<ReadResult>("fs_read_file", {
    path,
    workspace: currentWorkspaceEnv(),
  }).catch(() => null);
  return res?.kind === "text" ? (res.content ?? null) : null;
}

// Minimal change dispatch: trimming the common prefix/suffix keeps the
// cursor in place through CodeMirror's position mapping.
export function applyFormattedContent(view: EditorView, next: string): void {
  const current = view.state.doc.toString();
  if (current === next) return;
  let start = 0;
  const minLen = Math.min(current.length, next.length);
  while (start < minLen && current[start] === next[start]) start += 1;
  let endCur = current.length;
  let endNext = next.length;
  while (
    endCur > start &&
    endNext > start &&
    current[endCur - 1] === next[endNext - 1]
  ) {
    endCur -= 1;
    endNext -= 1;
  }
  view.dispatch({
    changes: { from: start, to: endCur, insert: next.slice(start, endNext) },
  });
}
