import { usePreferencesStore } from "@/modules/settings/preferences";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type { Extension } from "@codemirror/state";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { TeraxLspClient } from "./client";
import { detectBinary } from "./detect";
import { type LspPreset, serverForLanguage } from "./presets";
import { useLspRuntimeStore } from "./runtimeStore";
import type { TauriLspTransport } from "./transport";
import { pathToFileUri } from "./uri";

const IDLE_SHUTDOWN_MS = 3 * 60 * 1000;
const CRASH_WINDOW_MS = 5 * 60 * 1000;
const MAX_CRASHES = 3;
const SHUTDOWN_TIMEOUT_MS = 2000;

type Managed = {
  key: string;
  preset: LspPreset;
  root: string;
  client: TeraxLspClient;
  transport: TauriLspTransport;
  refs: Map<string, number>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closing: boolean;
};

export type LspDocHandle = {
  extension: Extension;
  release: () => void;
};

const sessions = new Map<string, Managed>();
const creating = new Map<string, Promise<Managed | null>>();
const crashTimes = new Map<string, number[]>();

function dirname(path: string): string {
  const segs = path.split(/[\\/]/);
  segs.pop();
  return segs.join("/") || "/";
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function crashedOut(key: string): boolean {
  const now = Date.now();
  const times = (crashTimes.get(key) ?? []).filter(
    (t) => now - t < CRASH_WINDOW_MS,
  );
  crashTimes.set(key, times);
  return times.length >= MAX_CRASHES;
}

function recordCrash(key: string): void {
  const times = crashTimes.get(key) ?? [];
  times.push(Date.now());
  crashTimes.set(key, times);
}

export async function acquireDocExtension(
  path: string,
  langId: string,
): Promise<LspDocHandle | null> {
  if (currentWorkspaceEnv().kind !== "local") return null;
  const prefs = usePreferencesStore.getState();
  const preset = serverForLanguage(langId, prefs.lspCustomServers);
  if (!preset) return null;
  if (prefs.lspActivation[preset.id] !== "enabled") return null;
  if (!(await detectBinary(preset.command))) return null;

  const root =
    (await invoke<string | null>("lsp_resolve_root", {
      path,
      markers: preset.rootMarkers,
    }).catch(() => null)) ?? dirname(path);
  const key = `${preset.id}\u0000${root}`;
  if (crashedOut(key)) return null;

  const managed =
    sessions.get(key) ?? (await getOrCreateSession(key, preset, root));
  if (!managed) return null;

  const uri = pathToFileUri(path);
  const languageId = preset.languages[langId] ?? langId;
  const mod = await import("./client");
  const extension = mod.languageServerWithTransport({
    client: managed.client,
    transport: managed.transport,
    rootUri: pathToFileUri(managed.root),
    workspaceFolders: [
      { uri: pathToFileUri(managed.root), name: basename(managed.root) },
    ],
    documentUri: uri,
    languageId,
    allowHTMLContent: false,
    synchronizationMethod: mod.SynchronizationMethod.Incremental,
  }) as Extension;

  addRef(managed, uri);
  let released = false;
  return {
    extension,
    release: () => {
      if (released) return;
      released = true;
      releaseRef(managed, uri);
    },
  };
}

function getOrCreateSession(
  key: string,
  preset: LspPreset,
  root: string,
): Promise<Managed | null> {
  let inflight = creating.get(key);
  if (!inflight) {
    inflight = createSession(key, preset, root).finally(() =>
      creating.delete(key),
    );
    creating.set(key, inflight);
  }
  return inflight;
}

async function createSession(
  key: string,
  preset: LspPreset,
  root: string,
): Promise<Managed | null> {
  const existing = sessions.get(key);
  if (existing) return existing;

  const store = useLspRuntimeStore.getState();
  store.upsertSession({ key, presetId: preset.id, root, status: "starting" });

  const [{ TauriLspTransport }, { TeraxLspClient }] = await Promise.all([
    import("./transport"),
    import("./client"),
  ]);

  const transport = new TauriLspTransport();
  try {
    await transport.start({ command: preset.command, args: preset.args, root });
  } catch (e) {
    recordCrash(key);
    store.removeSession(key, preset.id);
    toast.error(`${preset.name} language server failed to start`, {
      description: String(e),
    });
    return null;
  }

  const rootUri = pathToFileUri(root);
  const client = new TeraxLspClient({
    transport,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: basename(root) }],
    documentUri: rootUri,
    languageId: "",
    onClose: () => handleServerExit(key),
    onError: (e) => console.error(`[lsp:${preset.id}]`, e),
  });

  const managed: Managed = {
    key,
    preset,
    root,
    client,
    transport,
    refs: new Map(),
    idleTimer: null,
    closing: false,
  };
  sessions.set(key, managed);
  // Exit can beat the map insert when the binary dies instantly (e.g. a
  // rustup proxy for an uninstalled component); reap it here.
  if (transport.exitInfo) {
    handleServerExit(key);
    return null;
  }

  void client.initializePromise.then(() => {
    if (sessions.get(key) === managed) {
      useLspRuntimeStore
        .getState()
        .upsertSession({ key, presetId: preset.id, root, status: "running" });
    }
  });

  return managed;
}

function handleServerExit(key: string): void {
  const managed = sessions.get(key);
  if (!managed || managed.closing) return;
  managed.closing = true;
  if (managed.idleTimer) clearTimeout(managed.idleTimer);
  recordCrash(key);
  sessions.delete(key);
  managed.client.close();
  useLspRuntimeStore.getState().removeSession(key, managed.preset.id);
  const tail = managed.transport.exitInfo?.stderrTail;
  if (crashedOut(key)) {
    toast.error(`${managed.preset.name} language server keeps crashing`, {
      description: tail ? tail.slice(-300) : "Giving up for this workspace.",
    });
  } else if (tail) {
    toast.error(`${managed.preset.name} language server exited`, {
      description: tail.slice(-300),
    });
  }
}

function addRef(managed: Managed, uri: string): void {
  if (managed.idleTimer) {
    clearTimeout(managed.idleTimer);
    managed.idleTimer = null;
  }
  managed.refs.set(uri, (managed.refs.get(uri) ?? 0) + 1);
}

function releaseRef(managed: Managed, uri: string): void {
  const count = managed.refs.get(uri);
  if (count === undefined) return;
  if (count > 1) {
    managed.refs.set(uri, count - 1);
    return;
  }
  managed.refs.delete(uri);
  if (!managed.closing) managed.client.textDocumentDidClose(uri);
  if (managed.refs.size === 0 && !managed.closing) {
    managed.idleTimer = setTimeout(() => {
      void closeSession(managed);
    }, IDLE_SHUTDOWN_MS);
  }
}

async function closeSession(managed: Managed): Promise<void> {
  if (managed.closing) return;
  managed.closing = true;
  if (managed.idleTimer) {
    clearTimeout(managed.idleTimer);
    managed.idleTimer = null;
  }
  sessions.delete(managed.key);
  useLspRuntimeStore.getState().removeSession(managed.key, managed.preset.id);
  await managed.client.shutdownGracefully(SHUTDOWN_TIMEOUT_MS);
  managed.transport.close();
}

export function notifyDocumentSaved(path: string): void {
  const uri = pathToFileUri(path);
  for (const managed of sessions.values()) {
    if (managed.refs.has(uri) && !managed.closing) {
      managed.client.textDocumentDidSave(uri);
    }
  }
}

export async function stopPresetSessions(presetId: string): Promise<void> {
  const targets = [...sessions.values()].filter(
    (m) => m.preset.id === presetId,
  );
  await Promise.all(targets.map((m) => closeSession(m)));
  for (const key of crashTimes.keys()) {
    if (key.startsWith(`${presetId}\u0000`)) crashTimes.delete(key);
  }
}

// Disabling can happen in the Settings window; sessions live here. React to
// the mirrored preference change instead of a direct call.
usePreferencesStore.subscribe((state, prev) => {
  if (state.lspActivation === prev.lspActivation) return;
  for (const managed of sessions.values()) {
    if (state.lspActivation[managed.preset.id] !== "enabled") {
      void stopPresetSessions(managed.preset.id);
    }
  }
});
