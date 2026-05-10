import type { IMarker, Terminal } from "@xterm/xterm";

export function registerCwdHandler(
  term: Terminal,
  onCwd: (cwd: string) => void,
): () => void {
  const d = term.parser.registerOscHandler(7, (data) => {
    const cwd = parseOsc7(data);
    if (cwd) onCwd(cwd);
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

export type TeraxOpenTarget = "auto" | "preview" | "browser";

export type TeraxOpenInput =
  | {
      kind: "file";
      file: string;
    }
  | {
      kind: "url";
      url: string;
      target: TeraxOpenTarget;
    };

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

function parseOsc7(data: string): string | null {
  const m = data.match(/^file:\/\/[^/]*(\/.*)$/);
  if (!m) return null;
  let path = m[1];
  try {
    path = decodeURIComponent(path);
  } catch {}
  // /C:/Users/foo -> C:/Users/foo so it's a valid Windows path.
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path;
}

function parseTeraxOpen(data: string): TeraxOpenInput | null {
  const params = parseOscParams(data);
  const file = params.get("file");
  if (file) return { kind: "file", file };

  const url = params.get("url")?.trim();
  if (!url || !isSupportedUrl(url)) return null;

  return { kind: "url", url, target: parseTarget(params.get("target")) };
}

function parseOscParams(data: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of data.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    params.set(key, decodeParam(part.slice(i + 1)));
  }
  return params;
}

function decodeParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function isSupportedUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseTarget(value: string | undefined): TeraxOpenTarget {
  if (value === "preview" || value === "browser" || value === "auto") {
    return value;
  }
  return "auto";
}
