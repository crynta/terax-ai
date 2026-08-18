import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("playAgentNotificationSound", () => {
  it("lazily reuses one player and restarts the sound", async () => {
    const play = vi.fn(() => Promise.resolve());
    const players: Array<{
      src: string;
      currentTime: number;
      play: typeof play;
    }> = [];

    class AudioMock {
      currentTime = 12;
      play = play;

      constructor(public src: string) {
        players.push(this);
      }
    }

    vi.stubGlobal("Audio", AudioMock);
    const { playAgentNotificationSound } = await import("./sound");

    playAgentNotificationSound();
    playAgentNotificationSound();

    expect(players).toHaveLength(1);
    expect(players[0]?.src).toBe("/notification.mp3");
    expect(players[0]?.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("does not throw when playback is unavailable", async () => {
    vi.stubGlobal(
      "Audio",
      class {
        currentTime = 0;
        play() {
          throw new Error("unavailable");
        }
      },
    );
    const { playAgentNotificationSound } = await import("./sound");

    expect(() => playAgentNotificationSound()).not.toThrow();
  });
});
