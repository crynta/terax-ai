import { expect, it, vi } from "vitest";
import { useChatStore } from "@/modules/ai/store/chatStore";

const sessions = vi.hoisted(() => ({
  loadAll: vi.fn(async () => ({ sessions: [], activeId: null })),
  newSessionId: vi.fn(() => "s-new"),
  saveSessionsList: vi.fn(async () => {}),
  saveActiveId: vi.fn(async () => {}),
}));
vi.mock("@/modules/ai/lib/sessions", () => ({
  ...sessions,
  deleteSessionData: vi.fn(),
  deriveTitle: vi.fn(),
  loadMessages: vi.fn(),
  saveMessages: vi.fn(),
}));

it("creates one initial conversation when startup hydration overlaps", async () => {
  await Promise.all([
    useChatStore.getState().hydrateSessions(),
    useChatStore.getState().hydrateSessions(),
  ]);
  expect(sessions.newSessionId).toHaveBeenCalledOnce();
  expect(sessions.saveSessionsList).toHaveBeenCalledOnce();
  expect(sessions.saveActiveId).toHaveBeenCalledOnce();
  expect(useChatStore.getState()).toMatchObject({
    sessionsHydrated: true,
    activeSessionId: "s-new",
  });
});
