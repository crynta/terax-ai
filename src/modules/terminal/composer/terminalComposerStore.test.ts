import { beforeEach, describe, expect, it } from "vitest";

import { useTerminalComposerStore } from "./terminalComposerStore";

describe("terminal composer store", () => {
  beforeEach(() => {
    useTerminalComposerStore.getState().reset();
  });

  it("keeps independent drafts per terminal leaf", () => {
    const store = useTerminalComposerStore.getState();

    store.setDraft(101, "first draft");
    store.setDraft(202, "second draft");

    expect(useTerminalComposerStore.getState().draftFor(101)).toBe(
      "first draft",
    );
    expect(useTerminalComposerStore.getState().draftFor(202)).toBe(
      "second draft",
    );
  });

  it("consumes a non-blank draft without changing other leaves", () => {
    const store = useTerminalComposerStore.getState();

    store.setDraft(101, "  run this\nthen that  ");
    store.setDraft(202, "keep me");

    expect(useTerminalComposerStore.getState().consumeDraft(101)).toBe(
      "  run this\nthen that  ",
    );
    expect(useTerminalComposerStore.getState().draftFor(101)).toBe("");
    expect(useTerminalComposerStore.getState().draftFor(202)).toBe("keep me");
  });

  it("does not consume blank drafts", () => {
    const store = useTerminalComposerStore.getState();

    store.setDraft(101, " \n\t ");

    expect(useTerminalComposerStore.getState().consumeDraft(101)).toBeNull();
    expect(useTerminalComposerStore.getState().draftFor(101)).toBe(" \n\t ");
  });

  it("queues drafts FIFO per leaf and clears the queued draft", () => {
    const store = useTerminalComposerStore.getState();

    store.setDraft(101, "first queued prompt");
    const first = useTerminalComposerStore.getState().enqueueDraft(101);
    store.setDraft(101, "second queued prompt");
    const second = useTerminalComposerStore.getState().enqueueDraft(101);
    store.setDraft(202, "other leaf prompt");
    useTerminalComposerStore.getState().enqueueDraft(202);

    expect(first?.text).toBe("first queued prompt");
    expect(second?.text).toBe("second queued prompt");
    expect(useTerminalComposerStore.getState().draftFor(101)).toBe("");
    expect(useTerminalComposerStore.getState().queuedFor(101)).toMatchObject([
      { text: "first queued prompt" },
      { text: "second queued prompt" },
    ]);
    expect(useTerminalComposerStore.getState().dequeueNext(101)?.text).toBe(
      "first queued prompt",
    );
    expect(useTerminalComposerStore.getState().dequeueNext(101)?.text).toBe(
      "second queued prompt",
    );
    expect(useTerminalComposerStore.getState().dequeueNext(101)).toBeNull();
    expect(useTerminalComposerStore.getState().queuedFor(202)).toHaveLength(1);
  });

  it("dequeues a specific queued draft by id", () => {
    const store = useTerminalComposerStore.getState();

    store.setDraft(101, "first queued prompt");
    const first = useTerminalComposerStore.getState().enqueueDraft(101);
    store.setDraft(101, "second queued prompt");
    const second = useTerminalComposerStore.getState().enqueueDraft(101);

    expect(second).not.toBeNull();
    expect(
      useTerminalComposerStore.getState().dequeueById(101, second?.id ?? ""),
    ).toMatchObject({ text: "second queued prompt" });
    expect(useTerminalComposerStore.getState().queuedFor(101)).toMatchObject([
      { id: first?.id, text: "first queued prompt" },
    ]);
    expect(
      useTerminalComposerStore.getState().dequeueById(101, "missing"),
    ).toBeNull();
  });
});
