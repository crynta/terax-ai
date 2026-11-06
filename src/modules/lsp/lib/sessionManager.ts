import { usePreferencesStore } from "@/modules/settings/preferences";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { TeraxLspClient } from "./client";
import { detectBinary } from "./detect";
import { getLspNavigator } from "./navigator";
import { type LspPreset, serverForLanguage } from "./presets";
import { useLspRuntimeStore } from "./runtimeStore";
import type { TauriLspTransport } from "./transport";
import { fileUriToPath, pathToFileUri } from "./uri";

const IDLE_SHUTDOWN_MS = 3 * 60 * 1000;
const CRASH_WINDOW_MS = 5 * 60 * 1000;
const MAX_CRASHES = 3;
const SHUTDOWN_TIMEOUT_MS = 2000;
const MAX_SESSIONS_PER_PRESET = 4;
const CRASH_COOLDOWN_MS = [2_000, 10_000, 30_000];
const EVICTION_MIN_AGE_MS = 10_000;

type Managed = {
  key: string;
  preset: LspPreset;
  root: string;
  client: TeraxLspClient;
  transport: TauriLspTransport;
  refs: Map<string, number>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closing: boolean;
  closePromise?: Promise<void>;
  bornAt: number;
};

export type LspDocHandle = {
  extension: Extension;
  release: () => void;
};

const sessions = new Map<string, Managed>();
type Starting = {
  presetId: string;
  cancelled: boolean;
  promise: Promise<Managed | null>;
};
const creating = new Map<string, Starting>();
const stopping = new Map<string, Promise<void>>();
const crashTimes = new Map<string, number[]>();

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
  const preset = serverForLanguage(
    langId,
    prefs.lspCustomServers,
    prefs.lspActivation,
  );
  if (!preset) return null;
  if (prefs.lspActivation[preset.id] !== "enabled") return null;
  if (!(await detectBinary(preset.command))) return null;

  // No project root means no session: a per-directory fallback multiplied
  // servers per open file and burned gigabytes.
  const markers = preset.rootMarkers.length > 0 ? preset.rootMarkers : [".git"];
  const root = await invoke<string | null>("lsp_resolve_root", {
    path,
    markers,
  }).catch(() => null);
  if (!root) return null;
  const key = `${preset.id}\u0000${root}`;
  if (
    crashedOut(key) ||
    stopping.has(preset.id) ||
    usePreferencesStore.getState().lspActivation[preset.id] !== "enabled"
  )
    return null;
  if (
    !sessions.has(key) &&
    !creating.has(key) &&
    new Set([
      ...[...sessions.values()]
        .filter((m) => m.preset.id === preset.id)
        .map((m) => m.key),
      ...[...creating.entries()]
        .filter(([, start]) => start.presetId === preset.id)
        .map(([key]) => key),
    ]).size >= MAX_SESSIONS_PER_PRESET
  ) {
    console.warn(
      `[lsp] session cap reached for ${preset.id}, skipping ${root}`,
    );
    return null;
  }

  // Evict idle sessions of other roots; the age guard keeps simultaneous
  // multi-root opens from evicting each other's newborn sessions.
  if (!sessions.has(key)) {
    const now = Date.now();
    for (const m of sessions.values()) {
      if (
        m.preset.id === preset.id &&
        m.refs.size === 0 &&
        !m.closing &&
        now - m.bornAt > EVICTION_MIN_AGE_MS
      ) {
        void closeSession(m).catch(reportStopFailure);
      }
    }
  }

  const managed =
    sessions.get(key) ?? (await getOrCreateSession(key, preset, root));
  if (!managed || managed.closing) return null;

  const uri = pathToFileUri(path);
  const languageId = preset.languages[langId] ?? langId;
  const mod = await import("./client");
  if (managed.closing) return null;
  const extension: Extension = [
    mod.lspInteractions({
      client: managed.client,
      documentUri: uri,
      rootPath: managed.root.replace(/\\/g, "/"),
      onExternal: (extUri, line) => {
        const target = fileUriToPath(extUri);
        if (target) getLspNavigator()?.openFile(target, line);
      },
    }),
    mod.languageServerWithTransport({
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
    }) as Extension,
  ];

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
  let start = creating.get(key);
  if (!start) {
    start = {
      presetId: preset.id,
      cancelled: false,
      promise: Promise.resolve(null),
    };
    creating.set(key, start);
    start.promise = createSession(key, preset, root, start).finally(() =>
      creating.delete(key),
    );
  }
  return start.promise;
}

async function createSession(
  key: string,
  preset: LspPreset,
  root: string,
  start: Starting,
): Promise<Managed | null> {
  const existing = sessions.get(key);
  if (existing) return existing;

  const store = useLspRuntimeStore.getState();
  store.upsertSession({ key, presetId: preset.id, root, status: "starting" });

  const [{ TauriLspTransport }, { TeraxLspClient }] = await Promise.all([
    import("./transport"),
    import("./client"),
  ]);

  if (TeraxLspClient.hostPid === null) {
    TeraxLspClient.hostPid = await invoke<number>("lsp_host_pid").catch(
      () => null,
    );
  }

  if (start.cancelled) {
    store.removeSessionQuiet(key);
    return null;
  }
  const transport = new TauriLspTransport();
  try {
    await transport.start({
      command: preset.command,
      args: preset.args,
      root,
      env: preset.env,
      maxMemoryMb: preset.maxMemoryMb,
    });
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
    initializationOptions: preset.initializationOptions,
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
    bornAt: Date.now(),
  };
  sessions.set(key, managed);
  if (start.cancelled) {
    await closeSession(managed);
    return null;
  }
  // Exit can beat the map insert when the binary dies instantly (e.g. a
  // rustup proxy for an uninstalled component); reap it here.
  if (transport.exitInfo) {
    handleServerExit(key);
    return null;
  }

  void client.initializePromise.then(() => {
    if (sessions.get(key) === managed) {
      const runtime = useLspRuntimeStore.getState();
      runtime.clearFailed(preset.id);
      runtime.upsertSession({
        key,
        presetId: preset.id,
        root,
        status: "running",
      });
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
  useLspRuntimeStore.getState().removeSessionQuiet(key);
  const info = managed.transport.exitInfo;
  // Budget kills don't respawn: reloading would repay the startup peak
  // that got the server killed. Restart from the pill is explicit.
  if (info?.reason) {
    crashTimes.set(
      key,
      Array.from({ length: MAX_CRASHES }, () => Date.now()),
    );
    useLspRuntimeStore.getState().setFailed(managed.preset.id, info.reason);
    toast.error(`${managed.preset.name} language server stopped`, {
      description: info.reason,
    });
    return;
  }
  const tail = info?.stderrTail;
  if (crashedOut(key)) {
    useLspRuntimeStore
      .getState()
      .setFailed(
        managed.preset.id,
        tail ? tail.slice(-300) : "The server kept crashing.",
      );
    toast.error(`${managed.preset.name} language server keeps crashing`, {
      description: tail ? tail.slice(-300) : "Giving up for this workspace.",
    });
    return;
  }
  if (tail) {
    toast.error(`${managed.preset.name} language server exited`, {
      description: tail.slice(-300),
    });
  }
  // Delay the re-acquire trigger so an OOM-killed server doesn't respawn
  // into an instant second memory spike.
  const crashes = crashTimes.get(key)?.length ?? 1;
  const delay =
    CRASH_COOLDOWN_MS[Math.min(crashes - 1, CRASH_COOLDOWN_MS.length - 1)];
  setTimeout(
    () => useLspRuntimeStore.getState().bumpGeneration(managed.preset.id),
    delay,
  );
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
      void closeSession(managed).catch(reportStopFailure);
    }, IDLE_SHUTDOWN_MS);
  }
}

function reportStopFailure(error: unknown): void {
  console.error("[lsp] shutdown failed", error);
  toast.error("Language server failed to stop", { description: String(error) });
}

function closeSession(managed: Managed): Promise<void> {
  if (managed.closePromise) return managed.closePromise;
  managed.closing = true;
  if (managed.idleTimer) {
    clearTimeout(managed.idleTimer);
    managed.idleTimer = null;
  }
  managed.closePromise = (async () => {
    await managed.client.shutdownGracefully(SHUTDOWN_TIMEOUT_MS);
    await managed.transport.stop();
    sessions.delete(managed.key);
    useLspRuntimeStore.getState().removeSession(managed.key, managed.preset.id);
  })().catch((error) => {
    managed.closePromise = undefined;
    throw error;
  });
  return managed.closePromise;
}

export function notifyDocumentSaved(path: string): void {
  const uri = pathToFileUri(path);
  for (const managed of sessions.values()) {
    if (managed.refs.has(uri) && !managed.closing) {
      managed.client.textDocumentDidSave(uri);
    }
  }
}

function stopPresetSessions(presetId: string): Promise<void> {
  const existing = stopping.get(presetId);
  if (existing) return existing;
  const starts = [...creating.values()].filter((s) => s.presetId === presetId);
  for (const start of starts) start.cancelled = true;
  const stopped = Promise.resolve()
    .then(async () => {
      const targets = [...sessions.values()].filter(
        (m) => m.preset.id === presetId,
      );
      await Promise.all([
        ...targets.map((m) => closeSession(m)),
        ...starts.map((s) => s.promise),
      ]);
      for (const key of crashTimes.keys()) {
        if (key.startsWith(`${presetId}\u0000`)) crashTimes.delete(key);
      }
    })
    .finally(() => stopping.delete(presetId));
  stopping.set(presetId, stopped);
  return stopped;
}

export async function lspFormatDocument(
  view: EditorView,
): Promise<"done" | "unsupported"> {
  if (sessions.size === 0) return "unsupported";
  const { formatDocumentAndWait } = await import("./client");
  return formatDocumentAndWait(view);
}

// Open docs re-acquire automatically via the generation bump, so a stop
// while still enabled is a restart.
export async function restartPresetSessions(presetId: string): Promise<void> {
  await stopPresetSessions(presetId);
  const store = useLspRuntimeStore.getState();
  store.clearFailed(presetId);
  store.bumpGeneration(presetId);
}

// Disabling can happen in the Settings window; sessions live here. React to
// the mirrored preference change instead of a direct call.
usePreferencesStore.subscribe((state, prev) => {
  if (state.lspActivation === prev.lspActivation) return;
  for (const presetId of Object.keys(prev.lspActivation)) {
    if (state.lspActivation[presetId] !== "enabled") {
      void stopPresetSessions(presetId).catch(reportStopFailure);
    }
  }
});
