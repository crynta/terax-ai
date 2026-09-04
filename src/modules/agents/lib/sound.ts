let context: AudioContext | undefined;
let bufferPromise: Promise<AudioBuffer> | undefined;
let activeSource: AudioBufferSourceNode | undefined;
let requestSequence = 0;

async function loadSound(ctx: AudioContext): Promise<AudioBuffer> {
  const response = await fetch("/notification.mp3");
  if (!response.ok) throw new Error(`notification sound: ${response.status}`);
  return ctx.decodeAudioData(await response.arrayBuffer());
}

async function playLatest(sequence: number): Promise<void> {
  try {
    if (typeof AudioContext === "undefined" || typeof fetch === "undefined") return;
    context ??= new AudioContext();
    if (context.state === "suspended") await context.resume();

    bufferPromise ??= loadSound(context).catch((error) => {
      bufferPromise = undefined;
      throw error;
    });
    const buffer = await bufferPromise;
    if (sequence !== requestSequence) return;

    activeSource?.stop();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      if (activeSource !== source) return;
      activeSource = undefined;
      void context?.suspend().catch(() => undefined);
    };
    activeSource = source;
    source.start();
  } catch {
    return;
  }
}

export function playAgentNotificationSound(): void {
  void playLatest(++requestSequence);
}
