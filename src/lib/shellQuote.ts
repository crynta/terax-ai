import { IS_WINDOWS } from "./platform";

/** Characters a POSIX shell treats as syntax when a path is pasted unquoted. */
const POSIX_SHELL_SPECIAL = /([\\\s"'$`!&;|<>()[\]{}*?#~=])/g;
/** Literal characters in PowerShell argument mode. */
const WINDOWS_UNQUOTED_SAFE = /^[A-Za-z0-9_.:\\/+-]+$/;

const POSIX_UNQUOTED_SAFE = /^[A-Za-z0-9_@%+:,./-]+$/;

export function quoteShellArg(
  value: string,
  windows = IS_WINDOWS,
  unquotedWhenSafe = false,
): string {
  if (
    unquotedWhenSafe &&
    (windows ? WINDOWS_UNQUOTED_SAFE : POSIX_UNQUOTED_SAFE).test(value)
  )
    return value;
  if (windows) {
    return `'${value.replace(/['‘’]/g, "$&$&")}'`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function escapeForShell(path: string, windows = IS_WINDOWS): string {
  if (!path) return path;
  if (windows) {
    return WINDOWS_UNQUOTED_SAFE.test(path) ? path : quoteShellArg(path, true);
  }
  // Backslash-newline is a line continuation, not a literal newline.
  if (path.includes("\n")) return quoteShellArg(path, false);
  return path.replace(POSIX_SHELL_SPECIAL, "\\$1");
}

export function shellQuoteChar(c: string, windows: boolean): string {
  if (c === "'" || (windows && /[‘’]/.test(c))) return "'";
  if (c === '"' || (windows && /[“”]/.test(c))) return '"';
  return "";
}

/** Decode a literal argument, including an unfinished quote; never expand shell expressions. */
export function unescapeForShell(
  text: string,
  windows = IS_WINDOWS,
): string | null {
  let value = "";
  let quote = "";
  const escapeChar = windows ? "`" : "\\";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const delimiter = shellQuoteChar(c, windows);
    if (quote && delimiter === quote) {
      if (windows && shellQuoteChar(text[i + 1] ?? "", windows) === quote) {
        value += c;
        i++;
      } else {
        quote = "";
      }
    } else if (quote === "'") {
      value += c;
    } else if (c === escapeChar) {
      const next = text[i + 1];
      if (next === undefined) return null;
      if (!windows && quote === '"' && !'$`"\\\n'.includes(next)) {
        value += c;
      } else {
        if (windows && /[0abefnrtuvx]/i.test(next)) return null;
        if (next !== "\n") value += next;
        i++;
      }
    } else if (!quote && delimiter) {
      quote = delimiter;
    } else if (c === "$" || (!windows && (c === "`" || c === "!"))) {
      return null;
    } else if (!quote && /[\s;&|<>(){}*?[\]]/.test(c)) {
      return null;
    } else if (!quote && windows && (c === "," || (i === 0 && c === "@"))) {
      return null;
    } else if (!quote && i === 0 && /[~#=]/.test(c)) {
      return null;
    } else {
      value += c;
    }
  }
  return value;
}

export type ShellDialect = "posix" | "powershell" | "cmd";

export function shellDialect(program: string): ShellDialect | null {
  const name = program
    .split(/[\\/]/)
    .pop()
    ?.toLowerCase()
    .replace(/\.exe$/, "");
  if (name === "cmd") return "cmd";
  if (name === "powershell" || name === "pwsh") return "powershell";
  if (["bash", "zsh", "sh", "fish", "wsl"].includes(name ?? "")) return "posix";
  return null;
}

export function quotePathArg(value: string, dialect: ShellDialect): string {
  if (dialect !== "cmd")
    return quoteShellArg(value, dialect === "powershell", true);
  if (/[%!"\r\n]/.test(value))
    throw new Error(
      "This filename cannot be pasted literally into Command Prompt.",
    );
  return WINDOWS_UNQUOTED_SAFE.test(value) ? value : `"${value}"`;
}
