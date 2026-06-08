import { create } from "zustand";

/** LSP debug panel, status-bar button, and verbose RPC logging — dev builds only. */
export const LSP_DEV_TOOLS = import.meta.env.DEV;

export type LspDebugLevel = "info" | "out" | "in" | "error" | "warn";

export type LspDebugEntry = {
  id: number;
  at: number;
  level: LspDebugLevel;
  message: string;
  detail?: string;
};

export type LspSessionState =
  | "idle"
  | "unsupported"
  | "spawning"
  | "ready"
  | "error"
  | "closed";

export type LspSessionSnapshot = {
  state: LspSessionState;
  lastPath: string | null;
  command: string | null;
  args: string[];
  cwd: string | null;
  rootUri: string | null;
  languageId: string | null;
  transportId: number | null;
  poolKey: string | null;
  diagnosticCount: number;
  openDocuments: string[];
  error: string | null;
};

const MAX_ENTRIES = 300;

let entryId = 0;

const initialSession = (): LspSessionSnapshot => ({
  state: "idle",
  lastPath: null,
  command: null,
  args: [],
  cwd: null,
  rootUri: null,
  languageId: null,
  transportId: null,
  poolKey: null,
  diagnosticCount: 0,
  openDocuments: [],
  error: null,
});

type LspDebugStore = {
  panelOpen: boolean;
  entries: LspDebugEntry[];
  session: LspSessionSnapshot;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  push: (level: LspDebugLevel, message: string, detail?: string) => void;
  patchSession: (patch: Partial<LspSessionSnapshot>) => void;
  clear: () => void;
};

export const useLspDebugStore = create<LspDebugStore>((set, get) => ({
  panelOpen: false,
  entries: [],
  session: initialSession(),
  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set({ panelOpen: !get().panelOpen }),
  push: (level, message, detail) => {
    if (!LSP_DEV_TOOLS) return;
    const entry: LspDebugEntry = {
      id: ++entryId,
      at: Date.now(),
      level,
      message,
      detail,
    };
    set((s) => ({
      entries: [...s.entries, entry].slice(-MAX_ENTRIES),
    }));
  },
  patchSession: (patch) =>
    set((s) => ({ session: { ...s.session, ...patch } })),
  clear: () => set({ entries: [], session: initialSession() }),
}));

export function lspDebugPush(
  level: LspDebugLevel,
  message: string,
  detail?: string,
) {
  if (!LSP_DEV_TOOLS) return;
  useLspDebugStore.getState().push(level, message, detail);
}

export function lspDebugPatch(patch: Partial<LspSessionSnapshot>) {
  useLspDebugStore.getState().patchSession(patch);
}

export function formatLspPayload(json: string, max = 280): string {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const compact = JSON.stringify(parsed);
    if (compact.length <= max) return compact;
    return `${compact.slice(0, max)}...`;
  } catch {
    return json.length <= max ? json : `${json.slice(0, max)}...`;
  }
}
