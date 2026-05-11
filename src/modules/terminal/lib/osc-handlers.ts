import type { IMarker, Terminal } from "@xterm/xterm";

const MAX_OSC52_CLIPBOARD_BYTES = 1024 * 1024;
const MAX_OSC52_CLIPBOARD_CHARS =
  Math.ceil((MAX_OSC52_CLIPBOARD_BYTES * 4) / 3) + 4;

export function registerCwdHandler(
  term: Terminal,
  onCwd: (cwd: string) => void,
): () => void {
  let localHost: string | null = null;
  const d = term.parser.registerOscHandler(7, (data) => {
    const parsed = parseOsc7(data);
    if (!parsed) return true;
    if (localHost === null) localHost = parsed.host;
    const cwd =
      parsed.host && localHost && parsed.host !== localHost
        ? `ssh://${parsed.host}${parsed.path}`
        : parsed.path;
    onCwd(cwd);
    return true;
  });
  return () => d.dispose();
}

export function registerClipboardHandler(term: Terminal): () => void {
  const d = term.parser.registerOscHandler(52, (data) => {
    void handleOsc52Clipboard(data);
    return true;
  });
  return () => d.dispose();
}

export type PromptTracker = {
  getMarker: () => IMarker | null;
  dispose: () => void;
};

export function registerPromptTracker(term: Terminal): PromptTracker {
  let marker: IMarker | null = null;
  const d = term.parser.registerOscHandler(133, (data) => {
    if (data.startsWith("A")) {
      marker?.dispose();
      marker = term.registerMarker(0);
    }
    return true;
  });
  return {
    getMarker: () => (marker && !marker.isDisposed ? marker : null),
    dispose: () => {
      d.dispose();
      marker?.dispose();
      marker = null;
    },
  };
}

export type TeraxOpenInput =
  | { kind: "file"; file: string }
  | { kind: "url"; url: string; target: "preview" | "browser" }
  | { kind: "remote-cwd"; cwd: string };

export function registerTeraxOpenHandler(
  term: Terminal,
  onTeraxOpen: (input: TeraxOpenInput) => void,
): () => void {
  const d = term.parser.registerOscHandler(8888, (data) => {
    const input = parseTeraxOpen(data);
    if (input) onTeraxOpen(input);
    return true;
  });
  return () => d.dispose();
}

function parseOsc7(data: string): { host: string; path: string } | null {
  const m = data.match(/^file:\/\/([^/]*)(\/.*)$/);
  if (!m) return null;
  const host = m[1];
  let path = m[2];
  try {
    path = decodeURIComponent(path);
  } catch {}
  // /C:/Users/foo -> C:/Users/foo so it's a valid Windows path.
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return { host, path };
}

async function handleOsc52Clipboard(data: string): Promise<void> {
  const separator = data.indexOf(";");
  if (separator < 0) return;

  const selection = data.slice(0, separator);
  const payload = data.slice(separator + 1).replace(/\s/g, "");
  if (!selection || !payload || payload === "?") return;
  if (payload.length > MAX_OSC52_CLIPBOARD_CHARS) return;
  if (!navigator.clipboard?.writeText) return;

  try {
    const bytes = decodeBase64(payload);
    if (bytes.byteLength > MAX_OSC52_CLIPBOARD_BYTES) return;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.warn("Failed to handle OSC 52 clipboard data:", err);
  }
}

function decodeBase64(payload: string): Uint8Array {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseTeraxOpen(data: string): TeraxOpenInput | null {
  const params = parseParams(data);
  const file = params.get("file");
  if (file) return { kind: "file", file };

  const url = params.get("url");
  if (url && isSafeUrl(url)) {
    const target = params.get("target");
    return {
      kind: "url",
      url,
      target: target === "browser" ? "browser" : "preview",
    };
  }

  const cwd = params.get("remote-cwd");
  if (cwd && cwd.startsWith("ssh://")) return { kind: "remote-cwd", cwd };

  return null;
}

function parseParams(data: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of data.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const rawValue = part.slice(i + 1);
    if (!key || params.has(key)) continue;
    try {
      params.set(key, decodeURIComponent(rawValue));
    } catch {
      params.set(key, rawValue);
    }
  }
  return params;
}

function isSafeUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
