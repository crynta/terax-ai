export type SshCommandSpec = {
  user: string | null;
  host: string;
  port: number | null;
  rawTarget: string;
};

const SSH_OPTIONS_WITH_VALUE = new Set([
  "-b",
  "-c",
  "-D",
  "-E",
  "-F",
  "-I",
  "-i",
  "-J",
  "-L",
  "-l",
  "-m",
  "-O",
  "-o",
  "-p",
  "-Q",
  "-R",
  "-S",
  "-W",
  "-w",
]);

type Token = {
  value: string;
  quoted: boolean;
};

export class SshCommandTracker {
  private buffer = "";
  private inEscape = false;

  reset(): void {
    this.buffer = "";
    this.inEscape = false;
  }

  feed(data: string): SshCommandSpec | null {
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      if (this.inEscape) {
        if (isEscapeFinalByte(ch)) this.inEscape = false;
        continue;
      }

      if (ch === "\u001b") {
        this.inEscape = true;
        continue;
      }

      if (ch === "\r" || ch === "\n") {
        const cmd = this.buffer;
        this.reset();
        const spec = parseSshCommandLine(cmd);
        if (spec) return spec;
        continue;
      }

      if (ch === "\u007f" || ch === "\b") {
        this.buffer = this.buffer.slice(0, -1);
        continue;
      }

      if (ch === "\u0015") {
        this.buffer = "";
        continue;
      }

      if (ch === "\u0017") {
        this.buffer = this.buffer.replace(/\s+\S*$/, "");
        continue;
      }

      if (!isIgnorableControl(ch)) {
        this.buffer += ch;
      }
    }
    return null;
  }
}

function isIgnorableControl(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code < 0x20 && ch !== "\t";
}

function isEscapeFinalByte(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x40 && code <= 0x7e;
}

function tokenizeShell(line: string): Token[] {
  const out: Token[] = [];
  let current = "";
  let quoted = false;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const push = () => {
    if (!current && !quoted) return;
    out.push({ value: current, quoted });
    current = "";
    quoted = false;
  };

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (quote === '"') {
      if (ch === '"') {
        quote = null;
      } else if (ch === "\\") {
        escaped = true;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      quoted = true;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      quoted = true;
      continue;
    }
    if (/\s/.test(ch)) {
      push();
      continue;
    }
    current += ch;
  }
  push();
  return out;
}

export function parseSshCommandLine(line: string): SshCommandSpec | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const tokens = tokenizeShell(trimmed);
  if (tokens.length === 0) return null;
  if (tokens[0]?.value !== "ssh" || tokens[0].quoted) return null;

  let port: number | null = null;
  let target: string | null = null;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    const value = token.value;
    if (!value) continue;
    if (value === "--") {
      target = tokens[i + 1]?.value ?? null;
      break;
    }
    if (value.startsWith("-")) {
      if (value === "-p" && tokens[i + 1]) {
        const next = tokens[++i];
        const parsed = Number.parseInt(next.value, 10);
        if (Number.isFinite(parsed)) port = parsed;
        continue;
      }
      if (SSH_OPTIONS_WITH_VALUE.has(value) && tokens[i + 1]) {
        i++;
        continue;
      }
      if (/^-[^-]/.test(value) && value.length > 2) {
        const opt = value.slice(0, 2);
        if (SSH_OPTIONS_WITH_VALUE.has(opt) && value.length > 2) {
          if (opt === "-p") {
            const parsed = Number.parseInt(value.slice(2), 10);
            if (Number.isFinite(parsed)) port = parsed;
          }
          continue;
        }
      }
      continue;
    }
    target = value;
    break;
  }

  if (!target) return null;

  let user: string | null = null;
  let host = target;
  if (host.startsWith("[") && host.includes("]")) {
    const close = host.indexOf("]");
    host = host.slice(1, close);
  }
  const at = host.indexOf("@");
  if (at >= 0) {
    user = host.slice(0, at) || null;
    host = host.slice(at + 1);
  }
  host = host.trim();
  if (!host) return null;
  return {
    user,
    host,
    port,
    rawTarget: target,
  };
}
