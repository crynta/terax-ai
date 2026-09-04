import { afterEach, describe, expect, it, vi } from "vitest";

type SourceMock = {
  buffer: AudioBuffer | null;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
};

function installAudioMocks(initialState: AudioContextState = "running") {
  const decoded = {} as AudioBuffer;
  const sources: SourceMock[] = [];
  const destination = {} as AudioDestinationNode;
  const decodeAudioData = vi.fn(async () => decoded);
  const resume = vi.fn(async () => undefined);
  const suspend = vi.fn(async () => undefined);
  const contexts: AudioContextMock[] = [];

  class AudioContextMock {
    state: AudioContextState = initialState;
    destination = destination;
    decodeAudioData = decodeAudioData;
    resume = resume;
    suspend = suspend;

    constructor() {
      contexts.push(this);
    }

    createBufferSource(): SourceMock {
      const source: SourceMock = {
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      sources.push(source);
      return source;
    }
  }

  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(4),
  }));
  vi.stubGlobal("AudioContext", AudioContextMock);
  vi.stubGlobal("fetch", fetchMock);
  return {
    contexts,
    decoded,
    sources,
    destination,
    decodeAudioData,
    fetchMock,
    suspend,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("playAgentNotificationSound", () => {
  it("lazily decodes once and restarts a Web Audio source", async () => {
    const mocks = installAudioMocks();
    const { playAgentNotificationSound } = await import("./sound");

    playAgentNotificationSound();
    await vi.waitFor(() => expect(mocks.sources[0]?.start).toHaveBeenCalledOnce());
    playAgentNotificationSound();
    await vi.waitFor(() => expect(mocks.sources[1]?.start).toHaveBeenCalledOnce());

    expect(mocks.contexts).toHaveLength(1);
    expect(mocks.fetchMock).toHaveBeenCalledOnce();
    expect(mocks.fetchMock).toHaveBeenCalledWith("/notification.mp3");
    expect(mocks.decodeAudioData).toHaveBeenCalledOnce();
    expect(mocks.sources[0]?.stop).toHaveBeenCalledOnce();
    expect(mocks.sources[1]?.buffer).toBe(mocks.decoded);
    expect(mocks.sources[1]?.connect).toHaveBeenCalledWith(mocks.destination);
    mocks.sources[1]?.onended?.();
    expect(mocks.suspend).toHaveBeenCalledOnce();
  });

  it("collapses concurrent requests to the latest playback", async () => {
    const mocks = installAudioMocks();
    const { playAgentNotificationSound } = await import("./sound");

    playAgentNotificationSound();
    playAgentNotificationSound();
    await vi.waitFor(() => expect(mocks.sources[0]?.start).toHaveBeenCalledOnce());

    expect(mocks.sources).toHaveLength(1);
    expect(mocks.fetchMock).toHaveBeenCalledOnce();
  });

  it("resumes a suspended context before playback", async () => {
    const mocks = installAudioMocks("suspended");
    const { playAgentNotificationSound } = await import("./sound");

    playAgentNotificationSound();
    await vi.waitFor(() => expect(mocks.sources[0]?.start).toHaveBeenCalledOnce());

    expect(mocks.contexts[0]?.resume).toHaveBeenCalledOnce();
  });

  it("fails silently when playback is unavailable", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const { playAgentNotificationSound } = await import("./sound");

    expect(() => playAgentNotificationSound()).not.toThrow();
  });
});
