import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialHoldState } from "./holdIntent";
import { useVoiceStore } from "./voiceStore";

function impl(over: { supported?: boolean; hasKey?: boolean } = {}) {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    supported: over.supported ?? true,
    hasKey: over.hasKey ?? true,
  };
}

function reset() {
  useVoiceStore.setState({
    status: "idle",
    supported: false,
    hasKey: false,
    armed: false,
    hold: initialHoldState,
    impl: null,
    pending: null,
  });
}

describe("voice store deferred runtime", () => {
  beforeEach(reset);

  it("arms the runtime only when an intent would start recording", () => {
    useVoiceStore.getState().requestCancel();
    expect(useVoiceStore.getState().armed).toBe(false);

    useVoiceStore.getState().dispatchHold({ type: "down", at: 0 });
    expect(useVoiceStore.getState().armed).toBe(true);
  });

  it("replays a press that is still held when the runtime binds", () => {
    useVoiceStore.getState().dispatchHold({ type: "down", at: 0 });
    expect(useVoiceStore.getState().hold.phase).toBe("holding");

    const voice = impl();
    useVoiceStore.getState().bindImpl(voice);

    expect(voice.start).toHaveBeenCalledTimes(1);
    expect(useVoiceStore.getState().hold.phase).toBe("holding");
  });

  it("keeps the pending press through the controller's initial idle status", () => {
    useVoiceStore.getState().dispatchHold({ type: "down", at: 0 });
    useVoiceStore.getState().setStatus("idle");
    expect(useVoiceStore.getState().hold.phase).toBe("holding");

    const voice = impl();
    useVoiceStore.getState().bindImpl(voice);
    expect(voice.start).toHaveBeenCalledTimes(1);
  });

  it("replays a toggle that landed before the runtime bound", () => {
    useVoiceStore.getState().toggle();
    expect(useVoiceStore.getState().hold.phase).toBe("latched");

    const voice = impl();
    useVoiceStore.getState().bindImpl(voice);
    expect(voice.start).toHaveBeenCalledTimes(1);
  });

  it("starts nothing when the key was already released before binding", () => {
    useVoiceStore.getState().dispatchHold({ type: "down", at: 0 });
    useVoiceStore.getState().dispatchHold({ type: "up", at: 1000 });
    expect(useVoiceStore.getState().hold.phase).toBe("idle");

    const voice = impl();
    useVoiceStore.getState().bindImpl(voice);
    expect(voice.start).not.toHaveBeenCalled();
    expect(voice.stop).toHaveBeenCalledTimes(1);
  });

  it("drops the pending press when the bound runtime cannot record", () => {
    useVoiceStore.getState().dispatchHold({ type: "down", at: 0 });

    const voice = impl({ hasKey: false });
    useVoiceStore.getState().bindImpl(voice);

    expect(voice.start).not.toHaveBeenCalled();
    expect(useVoiceStore.getState().hold).toEqual(initialHoldState);
  });

  it("replays the pending press exactly once across rebinds", () => {
    useVoiceStore.getState().dispatchHold({ type: "down", at: 0 });

    const first = impl();
    useVoiceStore.getState().bindImpl(first);
    const second = impl();
    useVoiceStore.getState().bindImpl(second);

    expect(first.start).toHaveBeenCalledTimes(1);
    expect(second.start).not.toHaveBeenCalled();
  });

  it("blocks a start on a bound runtime without a key, as before", () => {
    const voice = impl({ hasKey: false });
    useVoiceStore.getState().bindImpl(voice);
    useVoiceStore.getState().dispatchHold({ type: "down", at: 0 });

    expect(voice.start).not.toHaveBeenCalled();
    expect(useVoiceStore.getState().hold).toEqual(initialHoldState);
  });
});
