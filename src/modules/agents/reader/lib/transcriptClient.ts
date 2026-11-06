import { invoke } from "@tauri-apps/api/core";
import { TranscriptBuffer, type TranscriptPage } from "./transcript";

/** Resolves a session's transcript; resolves to its size in bytes. */
export function openTranscript(sessionId: string): Promise<number> {
  return invoke<number>("agent_transcript_open", { sessionId });
}

/** Reads the tail (no options), forward from `offset`, or backward from `before`. */
export function readTranscript(
  sessionId: string,
  options: { offset?: number; before?: number } = {},
): Promise<TranscriptPage> {
  return invoke<TranscriptPage>("agent_transcript_read", {
    sessionId,
    offset: options.offset ?? null,
    before: options.before ?? null,
  });
}

/**
 * The newest session transcript for `cwd` modified at or after `sinceMs`, for
 * sessions whose hooks never reported an id, skipping `exclude` (sessions
 * other panes already own). Only safe when a single unlinked Claude session
 * runs in that cwd; the caller decides.
 */
export function findTranscript(
  cwd: string,
  sinceMs: number,
  exclude: readonly string[] = [],
): Promise<string | null> {
  return invoke<string | null>("agent_transcript_find", {
    cwd,
    sinceMs,
    exclude,
  });
}

/** Image types the composer can attach; the backend checks the bytes too. */
export const ATTACHABLE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export const ATTACHABLE_IMAGE_MAX_BYTES = 12 * 1024 * 1024;

/**
 * Saves an image pasted or dropped into the composer to the app cache and
 * resolves to its absolute path, which the prompt then names.
 */
export async function savePastedImage(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return invoke<string>("agent_save_pasted_image", bytes, {
    headers: { "x-terax-image-type": file.type },
  });
}

/** Copies an image file dropped on the composer into the cache; returns its cached path. */
export function saveDroppedImage(path: string): Promise<string> {
  return invoke<string>("agent_save_pasted_image_from_path", { path });
}

type TranscriptImage = { mediaType: string; data: string };

const IMAGE_CACHE_MAX = 24;
const imageCache = new Map<string, Promise<string>>();

/**
 * A pasted image as a `data:` URL, fetched on demand (never with the page) and
 * kept in a small LRU so scrolling back does not re-read the transcript.
 */
export function readTranscriptImage(
  sessionId: string,
  offset: number,
  index: number,
): Promise<string> {
  const key = `${sessionId}:${offset}:${index}`;
  const cached = imageCache.get(key);
  if (cached) {
    imageCache.delete(key);
    imageCache.set(key, cached);
    return cached;
  }
  const load = invoke<TranscriptImage>("agent_transcript_image", {
    sessionId,
    offset,
    index,
  }).then((image) => `data:${image.mediaType};base64,${image.data}`);
  load.catch(() => imageCache.delete(key));
  imageCache.set(key, load);
  while (imageCache.size > IMAGE_CACHE_MAX) {
    const oldest = imageCache.keys().next().value;
    if (oldest === undefined) break;
    imageCache.delete(oldest);
  }
  return load;
}

export const POLL_INTERVAL_MS = 500;

/** Polls only while the document is visible and the window has focus. */
export function documentIsActive(): boolean {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  );
}

export type TranscriptFollower = {
  readonly buffer: TranscriptBuffer;
  /** Reads now (e.g. on an agent signal) instead of waiting for the next tick. */
  poke(): void;
  /** Pages one window backwards; resolves to whether entries were added. */
  loadEarlier(): Promise<boolean>;
  /** Changes the poll interval from the next tick on (faster while Claude works). */
  setInterval(ms: number): void;
  stop(): void;
};

export type FollowOptions = {
  /** Called after the buffer changed. */
  onChange: (buffer: TranscriptBuffer) => void;
  onError?: (error: unknown) => void;
  /** Gates polling; defaults to {@link documentIsActive}. */
  isActive?: () => boolean;
  intervalMs?: number;
  read?: typeof readTranscript;
  buffer?: TranscriptBuffer;
};

/**
 * Tails a session transcript: the first read loads the last window, later
 * reads continue from the previous offset. Reads never overlap, and while
 * `isActive` is false no IPC happens at all.
 */
export function followTranscript(
  sessionId: string,
  options: FollowOptions,
): TranscriptFollower {
  const read = options.read ?? readTranscript;
  const isActive = options.isActive ?? documentIsActive;
  let interval = options.intervalMs ?? POLL_INTERVAL_MS;
  const buffer = options.buffer ?? new TranscriptBuffer();
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    const offset = buffer.nextOffset;
    inFlight = read(sessionId, offset === null ? {} : { offset })
      .then((page) => {
        if (!stopped && buffer.append(page)) options.onChange(buffer);
      })
      .catch((error: unknown) => {
        if (!stopped) options.onError?.(error);
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      timer = null;
      if (isActive()) await tick();
      schedule();
    }, interval);
  };

  void tick().then(schedule);

  return {
    buffer,
    poke: () => void tick(),
    async loadEarlier() {
      if (stopped || !buffer.canLoadEarlier) return false;
      await inFlight;
      try {
        const page = await read(sessionId, { before: buffer.startOffset });
        if (stopped) return false;
        const added = buffer.prepend(page);
        if (added) options.onChange(buffer);
        return added;
      } catch (error) {
        options.onError?.(error);
        return false;
      }
    },
    setInterval(ms: number) {
      interval = Math.max(100, ms);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
