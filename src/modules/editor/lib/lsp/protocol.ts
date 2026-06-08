export type LspPosition = { line: number; character: number };

export type LspRange = {
  start: LspPosition;
  end: LspPosition;
};

export type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

let nextId = 1;

export function rpcRequest(
  method: string,
  params: unknown,
): { id: number; payload: string } {
  const id = nextId++;
  return {
    id,
    payload: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  };
}

export function rpcNotification(method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", method, params });
}

export function rpcResponse(id: number, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

export function pathToUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

export function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  let path = decodeURIComponent(uri.slice("file://".length));
  if (path.startsWith("/") && /^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1);
  }
  return path;
}

export function sameFilePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

export function sameUri(a: string, b: string): boolean {
  return sameFilePath(uriToPath(a), uriToPath(b));
}

/** Toolchain / vendor sources — attach a separate LSP session there. */
export function isExternalLibraryPath(path: string): boolean {
  const norm = path.replace(/\\/g, "/").toLowerCase();
  return (
    norm.includes("/.rustup/") ||
    norm.includes("/rustlib/") ||
    norm.includes("/node_modules/") ||
    norm.includes("/target/debug/build/") ||
    norm.includes("/target/release/build/")
  );
}

export function offsetToPosition(text: string, offset: number): LspPosition {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
}

export type LspDiagnosticCode =
  | string
  | number
  | { value?: string; target?: unknown };

export function getDiagnosticCode(
  code?: LspDiagnosticCode,
): string | undefined {
  if (code == null) return undefined;
  if (typeof code === "string") return code;
  if (typeof code === "number") return String(code);
  if (typeof code === "object" && "value" in code) return code.value;
  return undefined;
}

/** rust-analyzer marks #[cfg]-disabled regions with this diagnostic code. */
export function isInactiveCodeDiagnostic(d: {
  code?: LspDiagnosticCode;
}): boolean {
  return getDiagnosticCode(d.code) === "inactive-code";
}

export function lspSeverityToCm(
  severity?: number,
): "error" | "warning" | "info" | "hint" {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    default:
      return "hint";
  }
}
