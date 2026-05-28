export type MediaKind = "image" | "video" | "audio" | null;

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "apng",
]);

const VIDEO_EXTS = new Set([
  "mp4", "webm", "mov", "mkv", "avi", "m4v", "ogv",
]);

const AUDIO_EXTS = new Set([
  "mp3", "wav", "ogg", "flac", "aac", "m4a", "opus",
]);

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  apng: "image/apng",
};

const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  ogv: "video/ogg",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
};

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  opus: "audio/opus",
};

export function ext(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

export function detectMediaKind(path: string): MediaKind {
  const e = ext(path);
  if (IMAGE_EXTS.has(e)) return "image";
  if (VIDEO_EXTS.has(e)) return "video";
  if (AUDIO_EXTS.has(e)) return "audio";
  return null;
}

export function guessMime(
  path: string,
  kind: "image" | "video" | "audio",
): string {
  const e = ext(path);
  if (kind === "image") return IMAGE_MIME[e] ?? "application/octet-stream";
  if (kind === "video") return VIDEO_MIME[e] ?? "video/mp4";
  return AUDIO_MIME[e] ?? "audio/mpeg";
}
