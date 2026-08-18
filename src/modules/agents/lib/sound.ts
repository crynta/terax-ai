let player: HTMLAudioElement | undefined;

export function playAgentNotificationSound(): void {
  if (typeof Audio === "undefined") return;

  try {
    player ??= new Audio("/notification.mp3");
    player.currentTime = 0;
    void player.play().catch(() => undefined);
  } catch {
    return;
  }
}
