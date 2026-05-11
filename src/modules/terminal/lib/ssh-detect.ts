export type DetectedSshCommand = {
  host: string;
  uri: string;
};

const OPTION_ARGS = new Set([
  "-b",
  "-c",
  "-D",
  "-E",
  "-e",
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

export function detectSshCommand(line: string): DetectedSshCommand | null {
  const tokens = shellSplit(line.trim());
  if (tokens.length < 2 || tokens[0] !== "ssh") return null;

  let loginUser: string | null = null;
  let port: string | null = null;
  let target: string | null = null;

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--") {
      target = tokens[i + 1] ?? null;
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      target = token;
      break;
    }
    if (token.startsWith("-p") && token.length > 2) {
      port = token.slice(2);
      continue;
    }
    if (token.startsWith("-l") && token.length > 2) {
      loginUser = token.slice(2);
      continue;
    }
    if (token === "-p") {
      port = tokens[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "-l") {
      loginUser = tokens[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (OPTION_ARGS.has(token)) i += 1;
  }

  if (!target || target.startsWith("-") || target.includes("/")) return null;

  const at = target.lastIndexOf("@");
  const user = at > 0 ? target.slice(0, at) : loginUser;
  const hostPort = at > 0 ? target.slice(at + 1) : target;
  const parsed = splitHostPort(hostPort);
  if (!parsed.host) return null;

  const portPart = parsed.port ?? port;
  const authority = `${user ? `${encodeURIComponent(user)}@` : ""}${parsed.host}${
    portPart ? `:${portPart}` : ""
  }`;
  return { host: parsed.host, uri: `ssh://${authority}/` };
}

export function createSshCommandDetector(
  onDetected: (detected: DetectedSshCommand) => void,
): (data: string) => void {
  let line = "";

  return (data: string) => {
    for (const ch of data) {
      if (ch === "\r" || ch === "\n") {
        const detected = detectSshCommand(line);
        if (detected) onDetected(detected);
        line = "";
        continue;
      }
      if (ch === "\u0003" || ch === "\u0015") {
        line = "";
        continue;
      }
      if (ch === "\u007f" || ch === "\b") {
        line = line.slice(0, -1);
        continue;
      }
      if (ch >= " " && ch !== "\u007f") line += ch;
    }

    if (line.length > 4096) line = "";
  };
}

function shellSplit(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

function splitHostPort(value: string): { host: string; port: string | null } {
  if (value.startsWith("[") && value.includes("]")) {
    const end = value.indexOf("]");
    const host = value.slice(1, end);
    const rest = value.slice(end + 1);
    return { host, port: rest.startsWith(":") ? rest.slice(1) : null };
  }

  const colon = value.lastIndexOf(":");
  if (colon > 0 && value.indexOf(":") === colon) {
    return { host: value.slice(0, colon), port: value.slice(colon + 1) };
  }
  return { host: value, port: null };
}
