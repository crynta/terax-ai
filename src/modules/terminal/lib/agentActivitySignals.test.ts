import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { payload: unknown }) => void;
const handlers: Handler[] = [];

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, handler: Handler) => {
    handlers.push(handler);
    return Promise.resolve(() => {});
  }),
}));

const { ensureAgentActivityListener, useAgentActivityStore } = await import(
  "./agentActivity"
);

const SESSION = "0b5f4c2e-9a1d-4e3b-8c7f-1234567890ab";

function emit(payload: unknown): void {
  for (const handler of handlers) handler({ payload });
}

describe("agent signal listener", () => {
  beforeEach(async () => {
    useAgentActivityStore.setState({ phases: {}, agents: {}, sessionIds: {} });
    await ensureAgentActivityListener();
  });

  it("records the session id from a linked signal without changing the phase", () => {
    emit({ id: 4, kind: "started", agent: "claude" });
    emit({ id: 4, kind: "linked", agent: null, session: SESSION });
    const state = useAgentActivityStore.getState();
    expect(state.sessionIds).toEqual({ 4: SESSION });
    expect(state.phases).toEqual({ 4: "idle" });
  });

  it("ignores a linked signal without a session and forgets it on exit", () => {
    emit({ id: 5, kind: "linked", agent: null });
    expect(useAgentActivityStore.getState().sessionIds).toEqual({});
    emit({ id: 5, kind: "started", agent: "claude" });
    emit({ id: 5, kind: "linked", session: SESSION });
    emit({ id: 5, kind: "exited" });
    expect(useAgentActivityStore.getState().sessionIds).toEqual({});
  });
});
