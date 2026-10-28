import type { UIMessage } from "@ai-sdk/react";
import { invoke } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";
import { toast } from "sonner";

export type SessionMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

const STORE_PATH = "terax-ai-sessions.json";
const KEY_SESSIONS = "sessions";
const KEY_ACTIVE = "activeId";
const LEGACY_PREFIX = "messages:";
/** A pre-migration copy older than this, with nothing left to migrate, goes. */
const LEFTOVER_BACKUP_MAX_AGE_SECS = 7 * 24 * 60 * 60;
const DEFAULT_FLUSH_TIMEOUT_MS = 5_000;
const VALID_ID = /^[A-Za-z0-9_-]{1,128}$/;

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type LoadedSessions = {
  sessions: SessionMeta[];
  activeId: string | null;
};

export type FlushResult = {
  /** Everything queued reached the disk and the metadata store saved. */
  ok: boolean;
  timedOut: boolean;
  /** Sessions whose latest write is still failing. */
  failed: string[];
};

type WriteOp =
  | { kind: "save"; messages: UIMessage[]; durable: boolean }
  | { kind: "delete" };
type Waiter = { resolve: () => void; reject: (error: unknown) => void };

let migration: Promise<void> | null = null;
/** Tail of each session's storage queue. Writes, loads and deletes run in order. */
const operations = new Map<string, Promise<unknown>>();
/** The one write waiting behind whatever is running; newer requests replace it. */
const pendingWrites = new Map<string, { op: WriteOp; waiters: Waiter[] }>();
/** The latest write that failed per session, retried on request and at close. */
const failedWrites = new Map<string, WriteOp>();
const notices = new Set<string>();

function escapeHeader(value: unknown): string {
  return JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

async function saveNative(
  id: string,
  messages: UIMessage[],
  options: { migrate?: boolean; durable?: boolean } = {},
): Promise<void> {
  await invoke("ai_session_save", encoder.encode(JSON.stringify(messages)), {
    headers: {
      "x-terax-session": escapeHeader({
        id,
        migrate: options.migrate === true,
        durable: options.durable === true,
      }),
    },
  });
}

/**
 * Legacy conversations lived under `messages:<id>` keys of the metadata store.
 * Each one moves independently: a damaged value or an unusable id is skipped
 * and reported, and never blocks the others or the rest of history. The
 * pre-migration copy is deleted once every migrated conversation reads back.
 */
function migrateMessages(): Promise<void> {
  migration ??= (async () => {
    const keys = await store.keys();
    const legacy = keys.filter((key) => key.startsWith(LEGACY_PREFIX));
    if (legacy.length === 0) {
      await invoke("ai_session_prune_backup", {
        maxAgeSecs: LEFTOVER_BACKUP_MAX_AGE_SECS,
      }).catch(() => {});
      return;
    }
    const migrated: string[] = [];
    const failed: string[] = [];
    for (const key of legacy) {
      const id = key.slice(LEGACY_PREFIX.length);
      try {
        const messages = await store.get<UIMessage[]>(key);
        if (messages !== undefined && messages !== null) {
          if (!VALID_ID.test(id) || !Array.isArray(messages)) {
            console.warn(`Skipping unmigratable chat history entry ${key}`);
            continue;
          }
          await saveNative(id, messages, { migrate: true, durable: true });
        }
        await store.delete(key);
        migrated.push(id);
      } catch (error) {
        failed.push(id);
        console.warn(`Could not migrate chat history ${key}:`, error);
      }
    }
    try {
      if (migrated.length > 0) await store.save();
      if (failed.length === 0 && migrated.length > 0) {
        await invoke("ai_session_finish_migration", { ids: migrated });
      }
    } catch (error) {
      console.warn("Could not finalize the chat history migration:", error);
    }
    if (failed.length > 0) {
      toast.warning("Some chat history could not be migrated", {
        id: "conversation-migration",
        description: `${failed.length} conversation${failed.length === 1 ? "" : "s"} will be retried next launch.`,
      });
    }
  })().catch((error) => {
    console.warn("Chat history migration failed:", error);
  });
  return migration;
}

function serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const previous = operations.get(id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  operations.set(id, next);
  void next
    .finally(() => {
      if (operations.get(id) === next) operations.delete(id);
    })
    .catch(() => {});
  return next;
}

function mergeOps(previous: WriteOp | undefined, next: WriteOp): WriteOp {
  if (next.kind === "delete" || previous?.kind !== "save") return next;
  // A durable request must survive being coalesced into a newer, lazier save.
  return { ...next, durable: next.durable || previous.durable };
}

async function execute(id: string, op: WriteOp): Promise<void> {
  await migrateMessages();
  if (op.kind === "save") {
    await saveNative(id, op.messages, { durable: op.durable });
    return;
  }
  await invoke("ai_session_delete", { id });
  const legacyKey = `${LEGACY_PREFIX}${id}`;
  if (await store.has(legacyKey)) await store.delete(legacyKey);
}

function reportFailure(id: string, error: unknown) {
  notices.add(id);
  toast.error("Could not save conversation", {
    id: `conversation-save:${id}`,
    duration: Number.POSITIVE_INFINITY,
    description: String(error),
    action: {
      label: "Retry",
      onClick: () => {
        const latest = failedWrites.get(id);
        if (latest && !pendingWrites.has(id)) {
          void write(id, latest).catch(() => {});
        }
      },
    },
  });
}

async function runPending(id: string): Promise<void> {
  const taken = pendingWrites.get(id);
  if (!taken) return;
  pendingWrites.delete(id);
  try {
    await execute(id, taken.op);
    failedWrites.delete(id);
    if (notices.delete(id)) toast.dismiss(`conversation-save:${id}`);
    for (const waiter of taken.waiters) waiter.resolve();
  } catch (error) {
    // A newer request already queued will overwrite this one anyway.
    if (!pendingWrites.has(id)) {
      failedWrites.set(id, taken.op);
      reportFailure(id, error);
    }
    for (const waiter of taken.waiters) waiter.reject(error);
  }
}

/**
 * Queues a write. While another storage operation for the same session is
 * running, newer writes replace the one waiting behind it, so a slow disk never
 * builds a backlog of obsolete conversation snapshots.
 */
function write(id: string, op: WriteOp): Promise<void> {
  const done = new Promise<void>((resolve, reject) => {
    const queued = pendingWrites.get(id);
    pendingWrites.set(id, {
      op: mergeOps(queued?.op, op),
      waiters: [...(queued?.waiters ?? []), { resolve, reject }],
    });
    if (!queued) void serial(id, () => runPending(id));
  });
  // Failures are reported to the user by `runPending`; callers that fire and
  // forget must not also raise an unhandled rejection.
  done.catch(() => {});
  return done;
}

export async function loadAll(): Promise<LoadedSessions> {
  await migrateMessages();
  const [sessions, activeId] = await Promise.all([
    store.get<SessionMeta[]>(KEY_SESSIONS),
    store.get<string>(KEY_ACTIVE),
  ]);
  return { sessions: sessions ?? [], activeId: activeId ?? null };
}

/**
 * `null` when the conversation does not exist, or was damaged and set aside by
 * the native side (reported once). Any other failure throws so the caller does
 * not start an empty conversation that would later replace a healthy file.
 */
export async function loadMessages(id: string): Promise<UIMessage[] | null> {
  await migrateMessages();
  try {
    return await serial(id, async () => {
      const buffer = await invoke<ArrayBuffer>("ai_session_load", { id });
      return buffer.byteLength === 0
        ? null
        : (JSON.parse(decoder.decode(buffer)) as UIMessage[]);
    });
  } catch (error) {
    if (!String(error).includes("corrupt:")) throw error;
    toast.error("A conversation file was damaged", {
      id: `conversation-damaged:${id}`,
      description: "It was set aside and the conversation starts empty.",
    });
    return null;
  }
}

export async function saveSessionsList(sessions: SessionMeta[]): Promise<void> {
  await serial("$metadata", () => store.set(KEY_SESSIONS, sessions));
}

export async function saveActiveId(id: string | null): Promise<void> {
  await serial("$metadata", () => store.set(KEY_ACTIVE, id));
}

/**
 * `durable` asks for the file to be synced to the device: turn ends, session
 * switches and window close. Mid-stream saves are plain atomic replaces.
 */
export function saveMessages(
  id: string,
  messages: UIMessage[],
  options: { durable?: boolean } = {},
): Promise<void> {
  return write(id, {
    kind: "save",
    messages,
    durable: options.durable === true,
  });
}

export function deleteSessionData(id: string): Promise<void> {
  return write(id, { kind: "delete" });
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), Math.max(0, ms));
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

/**
 * Drains queued writes for window close. It never rejects and never waits
 * longer than `timeoutMs`: a write that keeps failing or a stalled disk is
 * reported in the result, and the caller decides whether to close anyway.
 */
export async function flushSessionWrites(
  options: { timeoutMs?: number } = {},
): Promise<FlushResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
  const startedAt = Date.now();
  for (const [id, op] of [...failedWrites]) {
    if (pendingWrites.has(id)) continue;
    void write(id, op.kind === "save" ? { ...op, durable: true } : op).catch(
      () => {},
    );
  }
  const drain = async () => {
    while (operations.size > 0) {
      await Promise.allSettled([...operations.values()]);
    }
  };
  let timedOut = false;
  try {
    await withTimeout(drain(), timeoutMs);
  } catch {
    timedOut = true;
  }
  let metadataFailed = false;
  if (!timedOut) {
    try {
      await withTimeout(store.save(), timeoutMs - (Date.now() - startedAt));
    } catch {
      metadataFailed = true;
      timedOut = true;
    }
  }
  const failed = [...failedWrites.keys()];
  return {
    ok:
      !timedOut &&
      !metadataFailed &&
      failed.length === 0 &&
      pendingWrites.size === 0,
    timedOut,
    failed,
  };
}

export function newSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveTitle(messages: UIMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const p of m.parts) {
      if (p.type !== "text") continue;
      const text = (p as { text: string }).text
        .replace(/<terminal-context[\s\S]*?<\/terminal-context>\s*/g, "")
        .replace(/<selection[\s\S]*?<\/selection>\s*/g, "")
        .replace(/<file[\s\S]*?<\/file>\s*/g, "")
        .trim();
      if (!text) continue;
      const first = text.split("\n")[0].trim();
      return first.length > 40 ? `${first.slice(0, 40)}…` : first;
    }
  }
  return "New chat";
}
