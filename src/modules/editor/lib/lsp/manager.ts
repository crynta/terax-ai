import { invoke } from "@tauri-apps/api/core";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { openLspTransport } from "./bridge";
import { LspConnection } from "./connection";
import { LspDocumentClient } from "./client";
import { lspDebugPatch, lspDebugPush } from "./debugStore";
import { setFileDiagnostics } from "./diagnosticStore";
import { isExternalLibraryPath, pathToUri, sameUri, uriToPath } from "./protocol";
import {
  resolveLspServerSpecs,
  serverPoolKey,
  type LspServerSpec,
} from "./servers";
import {
  CompositeLspDocumentClient,
  type LspEditorClient,
} from "./editorClient";

type PoolEntry = {
  spec: LspServerSpec;
  rootUri: string;
  cwd: string;
  connection: Promise<LspConnection>;
  documents: Map<string, LspDocumentClient>;
  refs: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  diagnosticCache: Map<string, PublishDiagnosticsParams["diagnostics"]>;
  diagnosticSubscribed?: boolean;
};

type PublishDiagnosticsParams = {
  uri: string;
  diagnostics: Array<{
    range: LspRange;
    message: string;
    severity?: number;
    source?: string;
  }>;
};

type LspRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

const pool = new Map<string, PoolEntry>();

/** Keep server alive while preview-tab hopping between files in the same project. */
const POOL_IDLE_MS = 30 * 60 * 1000;
const RELEASE_DEBOUNCE_MS = 2500;

const pendingRelease = new Map<string, ReturnType<typeof setTimeout>>();
const attachInflight = new Map<string, Promise<LspEditorClient | null>>();

/** Tracks which server specs were attached per document path. */
const attachedSpecs = new Map<string, LspServerSpec[]>();

function supportsPullDiagnostics(spec: LspServerSpec): boolean {
  return spec.command.includes("rust-analyzer");
}

function supportsInlayHints(spec: LspServerSpec): boolean {
  return spec.command.includes("deps-lsp");
}

function normPath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function rootUriToCwd(rootUri: string): string {
  if (rootUri.startsWith("file:///")) {
    const path = rootUri.slice("file:///".length);
    if (/^[A-Za-z]:/.test(path)) return path;
    return `/${path}`;
  }
  if (rootUri.startsWith("file://")) {
    return rootUri.slice("file://".length);
  }
  return rootUri;
}

function parentDir(filePath: string): string {
  return filePath.replace(/[/\\][^/\\]+$/, "") || filePath;
}

async function resolveRootUri(
  filePath: string,
  spec: LspServerSpec,
): Promise<string> {
  let root: string;
  try {
    root = await invoke<string>("lsp_resolve_root", {
      filePath,
      command: spec.command,
      workspace: currentWorkspaceEnv(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    lspDebugPush("warn", "lsp_resolve_root failed", message);
    root = parentDir(filePath);
  }
  lspDebugPush("info", "root resolved", root);
  return pathToUri(root);
}

function poolKey(rootUri: string, spec: LspServerSpec): string {
  return `${rootUri}::${serverPoolKey(spec)}`;
}

function syncPoolSnapshot() {
  const docs = [...pool.values()].flatMap((e) => [...e.documents.keys()]);
  lspDebugPatch({ openDocuments: docs });
}

function cancelPoolIdle(entry: PoolEntry) {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }
}

async function closePoolEntry(key: string, entry: PoolEntry) {
  cancelPoolIdle(entry);
  try {
    const connection = await entry.connection;
    await connection.close();
  } catch {
    // spawn may have failed
  }
  pool.delete(key);
  lspDebugPush("info", "pool entry removed", key);
  lspDebugPatch({
    state: "closed",
    poolKey: null,
    transportId: null,
    openDocuments: [],
  });
}

function schedulePoolIdle(key: string, entry: PoolEntry) {
  cancelPoolIdle(entry);
  entry.idleTimer = setTimeout(() => {
    const current = pool.get(key);
    if (!current || current.documents.size > 0 || current.refs > 0) return;
    void closePoolEntry(key, current);
  }, POOL_IDLE_MS);
}

function findDocument(
  entry: PoolEntry,
  uri: string,
): LspDocumentClient | undefined {
  const key = normPath(uriToPath(uri));
  const direct = entry.documents.get(key);
  if (direct) return direct;
  for (const client of entry.documents.values()) {
    if (sameUri(uri, pathToUri(client.path))) return client;
  }
  return undefined;
}

function wireDiagnosticRouting(entry: PoolEntry) {
  if (entry.diagnosticSubscribed) return;
  entry.diagnosticSubscribed = true;
  void entry.connection.then((conn) => {
    for (const [docKey, items] of entry.diagnosticCache) {
      setFileDiagnostics(docKey, items);
    }
    conn.subscribe((msg) => {
      if (msg.method !== "textDocument/publishDiagnostics") return;
      const params = msg.params as PublishDiagnosticsParams;
      const docKey = normPath(uriToPath(params.uri));
      entry.diagnosticCache.set(docKey, params.diagnostics);
      // Authoritative source for explorer badges — one URI per notification.
      setFileDiagnostics(params.uri, params.diagnostics);
      findDocument(entry, params.uri)?.applyExternalDiagnostics(
        params.diagnostics,
      );
    });
  });
}

function cancelPendingRelease(path: string) {
  const key = normPath(path);
  const timer = pendingRelease.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingRelease.delete(key);
  }
}

export async function acquireLspClient(
  path: string,
  text: string,
): Promise<LspEditorClient | null> {
  return acquireLspClientInner(path, text);
}

async function acquireSingleDocumentClient(
  path: string,
  text: string,
  spec: LspServerSpec,
): Promise<LspDocumentClient | null> {
  const rootUri = await resolveRootUri(path, spec);
  const key = poolKey(rootUri, spec);
  lspDebugPatch({ rootUri, poolKey: key });

  let entry = pool.get(key);

  if (!entry) {
    const cwd = rootUriToCwd(rootUri);
    lspDebugPatch({ cwd });
    const connection = openLspTransport(spec.command, spec.args, cwd)
      .then(async (transport) => {
        const conn = await LspConnection.open(transport, rootUri, spec.command);
        lspDebugPush("info", "LSP initialized", `${spec.command} @ ${rootUri}`);
        lspDebugPatch({ state: "ready", error: null });
        return conn;
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        lspDebugPush("error", "connection failed", message);
        lspDebugPatch({ state: "error", error: message });
        pool.delete(key);
        throw e;
      });
    entry = {
      spec,
      rootUri,
      cwd,
      connection,
      documents: new Map(),
      refs: 0,
      diagnosticCache: new Map(),
    };
    pool.set(key, entry);
  }

  wireDiagnosticRouting(entry);
  cancelPoolIdle(entry);

  const docKey = normPath(path);
  const existing = entry.documents.get(docKey);
  if (existing) {
    entry.refs += 1;
    existing.syncEditor(text);
    syncPoolSnapshot();
    lspDebugPush("info", "reuse document client", `${spec.command} ${path}`);
    return existing;
  }

  try {
    const connection = await entry.connection;
    const client = new LspDocumentClient(
      path,
      text,
      spec.languageId,
      connection,
      {
        pullDiagnostics: supportsPullDiagnostics(spec),
        inlayHints: supportsInlayHints(spec),
      },
    );
    entry.documents.set(docKey, client);
    entry.refs += 1;
    const cached = entry.diagnosticCache.get(docKey);
    if (cached) client.applyExternalDiagnostics(cached);
    syncPoolSnapshot();
    lspDebugPush("info", "document opened", `${spec.command} ${path}`);
    lspDebugPatch({ state: "ready" });
    return client;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    lspDebugPush("error", "acquire failed", message);
    lspDebugPatch({ state: "error", error: message });
    pool.delete(key);
    return null;
  }
}

async function acquireLspClientInner(
  path: string,
  text: string,
): Promise<LspEditorClient | null> {
  cancelPendingRelease(path);

  const { lspEnabled } = usePreferencesStore.getState();
  if (!lspEnabled) {
    lspDebugPush("info", "LSP disabled in settings", path);
    lspDebugPatch({ state: "idle", lastPath: path, error: null });
    return null;
  }

  if (isExternalLibraryPath(path)) {
    lspDebugPush("info", "LSP skipped for library file", path);
    lspDebugPatch({ state: "idle", lastPath: path, error: null });
    return null;
  }

  lspDebugPatch({ lastPath: path, error: null });
  const specs = resolveLspServerSpecs(path);
  if (specs.length === 0) {
    lspDebugPush("warn", "unsupported file type", path);
    lspDebugPatch({
      state: "unsupported",
      command: null,
      languageId: null,
    });
    return null;
  }

  lspDebugPush(
    "info",
    "resolve server",
    specs.map((s) => `${s.command} (${s.languageId})`).join(" + "),
  );
  lspDebugPatch({
    command: specs[0]?.command ?? null,
    args: specs[0]?.args ?? [],
    languageId: specs[0]?.languageId ?? null,
  });

  const docKey = normPath(path);
  const pendingCreate = attachInflight.get(docKey);
  if (pendingCreate) {
    const client = await pendingCreate;
    if (!client) return null;
    client.syncEditor(text);
    lspDebugPush("info", "reuse document client (inflight)", path);
    return client;
  }

  const createPromise = (async (): Promise<LspEditorClient | null> => {
    const clients: LspDocumentClient[] = [];
    for (const spec of specs) {
      const client = await acquireSingleDocumentClient(path, text, spec);
      if (client) clients.push(client);
    }
    if (clients.length === 0) return null;
    attachedSpecs.set(docKey, specs);
    if (clients.length === 1) return clients[0]!;
    const inlay =
      clients.find((c) => c.hasInlayHints()) ??
      clients.find((c) => c.path === path) ??
      null;
    return new CompositeLspDocumentClient(path, clients, inlay);
  })();

  attachInflight.set(docKey, createPromise);
  try {
    return await createPromise;
  } finally {
    attachInflight.delete(docKey);
  }
}

export async function releaseLspClient(path: string): Promise<void> {
  const keyPath = normPath(path);
  cancelPendingRelease(path);
  pendingRelease.set(
    keyPath,
    setTimeout(() => {
      pendingRelease.delete(keyPath);
      void releaseLspClientNow(keyPath, path);
    }, RELEASE_DEBOUNCE_MS),
  );
}

async function releaseLspClientNow(keyPath: string, path: string) {
  const specs = attachedSpecs.get(keyPath) ?? [];
  attachedSpecs.delete(keyPath);

  const targets =
    specs.length > 0
      ? specs
      : [...pool.values()]
          .filter((e) => e.documents.has(keyPath))
          .map((e) => e.spec);

  for (const spec of targets) {
    const sk = serverPoolKey(spec);
    for (const [key, entry] of pool) {
      if (serverPoolKey(entry.spec) !== sk) continue;
      const client = entry.documents.get(keyPath);
      if (!client) continue;
      entry.refs = Math.max(0, entry.refs - 1);
      if (entry.refs > 0) {
        lspDebugPush(
          "info",
          "document ref released",
          `${entry.spec.command} ${path} refs=${entry.refs}`,
        );
        break;
      }
      client.closeDocument();
      entry.documents.delete(keyPath);
      lspDebugPush("info", "document closed", `${entry.spec.command} ${path}`);
      syncPoolSnapshot();
      if (entry.documents.size === 0) {
        schedulePoolIdle(key, entry);
      }
      break;
    }
  }
}

/** Immediately tear down every pooled server (e.g. when LSP is disabled in settings). */
export async function shutdownAllLsp(): Promise<void> {
  for (const timer of pendingRelease.values()) {
    clearTimeout(timer);
  }
  pendingRelease.clear();
  attachInflight.clear();
  attachedSpecs.clear();

  const entries = [...pool.entries()];
  await Promise.all(
    entries.map(async ([key, entry]) => {
      cancelPoolIdle(entry);
      for (const client of entry.documents.values()) {
        client.closeDocument();
      }
      entry.documents.clear();
      entry.refs = 0;
      await closePoolEntry(key, entry);
    }),
  );
}
