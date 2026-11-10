/**
 * What a Reader keeps when its tab is switched away (Terax unmounts hidden
 * tabs): each session's loaded transcript and where it was scrolled, so
 * coming back renders at once, in place, instead of reloading and jumping.
 */
import { TranscriptBuffer } from "./transcript";

/** Sessions kept loaded; each buffer is itself capped (entries and bytes). */
const MAX_SESSIONS = 8;

const buffers = new Map<string, TranscriptBuffer>();

/** The loaded transcript for `sessionId`, if a Reader showed it recently. */
export function cachedBuffer(sessionId: string): TranscriptBuffer | null {
  return buffers.get(sessionId) ?? null;
}

/** The buffer to follow `sessionId` with: the cached one, else a new one kept for later. */
export function bufferFor(sessionId: string): TranscriptBuffer {
  let buffer = buffers.get(sessionId);
  if (buffer) buffers.delete(sessionId);
  else buffer = new TranscriptBuffer();
  // Most recently used last; the oldest one goes first when full.
  buffers.set(sessionId, buffer);
  while (buffers.size > MAX_SESSIONS) {
    const oldest = buffers.keys().next().value;
    if (oldest === undefined) break;
    buffers.delete(oldest);
  }
  return buffer;
}

export type SavedScroll = { top: number; following: boolean };

const scrolls = new Map<string, SavedScroll>();

const scrollKey = (leafId: number, sessionId: string) =>
  `${leafId}:${sessionId}`;

export function saveScroll(
  leafId: number,
  sessionId: string,
  scroll: SavedScroll,
): void {
  scrolls.set(scrollKey(leafId, sessionId), scroll);
  if (scrolls.size > MAX_SESSIONS * 4) {
    const oldest = scrolls.keys().next().value;
    if (oldest !== undefined) scrolls.delete(oldest);
  }
}

export function savedScroll(
  leafId: number,
  sessionId: string,
): SavedScroll | null {
  return scrolls.get(scrollKey(leafId, sessionId)) ?? null;
}

/** Test hook: forget everything. */
export function clearReaderCache(): void {
  buffers.clear();
  scrolls.clear();
}
