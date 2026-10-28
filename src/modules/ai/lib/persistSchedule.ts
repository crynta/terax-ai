/**
 * When a streaming conversation is written to disk.
 *
 * Tokens arrive every few milliseconds, so a plain trailing debounce either
 * never fires mid-turn (continuous stream) or fires after every short pause.
 * The schedule instead saves after a quiet gap, never waits longer than
 * `PERSIST_MAX_WAIT_MS` from the first unsaved change, and never saves more
 * often than `PERSIST_MIN_INTERVAL_MS`. Turn ends, session switches and window
 * close flush immediately and durably, outside this schedule.
 */
export const PERSIST_QUIET_MS = 1_000;
export const PERSIST_MAX_WAIT_MS = 4_000;
export const PERSIST_MIN_INTERVAL_MS = 2_000;

/**
 * Milliseconds to wait before the next debounced save.
 *
 * @param now the current time
 * @param firstPendingAt when the oldest unsaved change was made
 * @param lastSavedAt when this conversation last started a save, if ever
 */
export function persistDelay(
  now: number,
  firstPendingAt: number,
  lastSavedAt: number | null,
): number {
  const quietDue = now + PERSIST_QUIET_MS;
  const deadline = firstPendingAt + PERSIST_MAX_WAIT_MS;
  const spacing =
    lastSavedAt === null ? now : lastSavedAt + PERSIST_MIN_INTERVAL_MS;
  const due = Math.max(Math.min(quietDue, deadline), spacing);
  return Math.max(0, Math.min(due, deadline) - now);
}
