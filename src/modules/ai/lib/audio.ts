/** Whisper's expected sample rate. The model is trained on 16 kHz mono. */
export const TARGET_SAMPLE_RATE = 16_000;

/**
 * Average all channels into a single mono Float32Array. For mono input
 * the channel is returned unchanged. Surround layouts are flattened to
 * a centered mix, which is acceptable for speech transcription.
 */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const len = channels[0].length;
  const out = new Float32Array(len);
  const n = channels.length;
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let c = 0; c < n; c++) s += channels[c][i];
    out[i] = s / n;
  }
  return out;
}

/**
 * Decode a MediaRecorder blob (WebM/Opus, OGG, MP4, etc.) to a mono
 * Float32 PCM array at TARGET_SAMPLE_RATE. Two OfflineAudioContexts:
 * one for decode (native rate), one for high-quality resample (target rate).
 */
export async function blobToMonoPcm16k(blob: Blob): Promise<Float32Array> {
  const ab = await blob.arrayBuffer();

  // A short-lived OfflineAudioContext for decoding. The frame count and
  // sample rate are irrelevant for decodeAudioData — they're just required
  // by the constructor.
  const decodeCtx = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE);
  const decoded = await decodeCtx.decodeAudioData(ab);

  // Collect the decoded channels into an array of Float32Arrays.
  const decodedChannels: Float32Array[] = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    decodedChannels.push(decoded.getChannelData(c));
  }
  const mono = downmixToMono(decodedChannels);

  // If already at the right rate, skip the render pass.
  if (decoded.sampleRate === TARGET_SAMPLE_RATE) return mono;

  const frames = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  const renderCtx = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const src = renderCtx.createBufferSource();
  // Use renderCtx.createBuffer to route buffer creation through the context
  // (compatible with test fakes and avoids a direct AudioBuffer constructor call).
  const buf = renderCtx.createBuffer(1, mono.length, decoded.sampleRate);
  buf.copyToChannel(mono, 0);
  src.buffer = buf;
  src.connect(renderCtx.destination);
  src.start(0);
  const rendered = await renderCtx.startRendering();
  return rendered.getChannelData(0);
}
