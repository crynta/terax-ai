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

/** OSC 133 A/B markers: A = prompt boundary, B = start of PS1 (before visible prompt). */
export type ShellIntegrationMarkers = {
  getPromptMarker: () => IMarker | null;
  getInputStartMarker: () => IMarker | null;
  dispose: () => void;
};

export type ShellIntegrationOptions = {
  /** Fires after OSC 133 A (new prompt line); use to reset input tracking. */
  onPromptStart?: () => void;
};

export function registerShellIntegrationMarkers(
  term: Terminal,
  options?: ShellIntegrationOptions,
): ShellIntegrationMarkers {
  let promptMarker: IMarker | null = null;
  let inputStartMarker: IMarker | null = null;
  const d = term.parser.registerOscHandler(133, (data) => {
    if (data.startsWith("A")) {
      promptMarker?.dispose();
      promptMarker = term.registerMarker(0);
      options?.onPromptStart?.();
    } else if (data.startsWith("B")) {
      inputStartMarker?.dispose();
      inputStartMarker = term.registerMarker(0);
    }
    return true;
  });
  return {
    getPromptMarker: () =>
      promptMarker && !promptMarker.isDisposed ? promptMarker : null,
    getInputStartMarker: () =>
      inputStartMarker && !inputStartMarker.isDisposed
        ? inputStartMarker
        : null,
    dispose: () => {
      d.dispose();
      promptMarker?.dispose();
      promptMarker = null;
      inputStartMarker?.dispose();
      inputStartMarker = null;
    },
  };
}

/** @deprecated Use registerShellIntegrationMarkers — kept for call sites that only need A. */
export function registerPromptTracker(term: Terminal): PromptTracker {
  const m = registerShellIntegrationMarkers(term);
  return {
    getMarker: () => m.getPromptMarker(),
    dispose: () => m.dispose(),
  };
}

export type TeraxOpenInput = {
  file: string;
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
  // Parse format: "file=/path/to/file"
  const fileMatch = data.match(/file=([^;]+)/);

  if (!fileMatch) return null;

  try {
    return { file: decodeURIComponent(fileMatch[1]) };
  } catch {
    return { file: fileMatch[1] };
  }
}
