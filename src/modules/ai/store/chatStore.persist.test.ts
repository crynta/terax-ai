import type { UIMessage } from "@ai-sdk/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPersist, useChatStore } from "@/modules/ai/store/chatStore";

const sessions = vi.hoisted(() => ({
  saveMessages: vi.fn(
    async (
      _id: string,
      _messages: unknown[],
      _options?: { durable?: boolean },
    ) => {},
  ),
  loadAll: vi.fn(async () => ({ sessions: [], activeId: null })),
  loadMessages: vi.fn(),
  saveSessionsList: vi.fn(async () => {}),
  saveActiveId: vi.fn(async () => {}),
  deleteSessionData: vi.fn(async () => {}),
  deriveTitle: vi.fn(() => "New chat"),
  newSessionId: vi.fn(() => "s-new"),
}));
vi.mock("@/modules/ai/lib/sessions", () => sessions);
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const messages = (n: number) =>
  [{ id: `m${n}`, role: "assistant", parts: [] }] as UIMessage[];

beforeEach(() => {
  vi.useFakeTimers();
  sessions.saveMessages.mockClear();
});
afterEach(() => {
  flushPersist();
  vi.useRealTimers();
});

it("saves a continuous stream every few seconds instead of once per pause or never", async () => {
  const { persistMessages } = useChatStore.getState();
  for (let elapsed = 0; elapsed < 12_000; elapsed += 20) {
    persistMessages("s-1", messages(elapsed));
    await vi.advanceTimersByTimeAsync(20);
  }
  const count = sessions.saveMessages.mock.calls.length;
  expect(count).toBeGreaterThanOrEqual(2);
  expect(count).toBeLessThanOrEqual(6);
  for (const call of sessions.saveMessages.mock.calls) {
    expect(call[2]).toEqual({ durable: false });
  }
});

it("writes the latest snapshot after a quiet gap, not every intermediate one", async () => {
  const { persistMessages } = useChatStore.getState();
  persistMessages("s-2", messages(1));
  persistMessages("s-2", messages(2));
  persistMessages("s-2", messages(3));
  expect(sessions.saveMessages).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_100);
  expect(sessions.saveMessages).toHaveBeenCalledOnce();
  expect(sessions.saveMessages.mock.calls[0][1]).toEqual(messages(3));
});

it("flushes durably at turn end and drops the pending timer", async () => {
  const { persistMessages } = useChatStore.getState();
  persistMessages("s-3", messages(1));
  flushPersist("s-3");
  expect(sessions.saveMessages).toHaveBeenCalledWith("s-3", messages(1), {
    durable: true,
  });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(sessions.saveMessages).toHaveBeenCalledOnce();
});

it("a window-close flush saves every conversation with pending changes durably", () => {
  const { persistMessages } = useChatStore.getState();
  persistMessages("a", messages(1));
  persistMessages("b", messages(2));
  flushPersist();
  expect(sessions.saveMessages.mock.calls.map((c) => [c[0], c[2]])).toEqual([
    ["a", { durable: true }],
    ["b", { durable: true }],
  ]);
});
