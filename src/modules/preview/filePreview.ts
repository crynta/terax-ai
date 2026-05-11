export type FilePreviewKind = "image" | "pdf" | "markdown" | "audio" | "video";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "oga", "flac", "m4a"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv"]);

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function extensionForPath(path: string): string {
  const name = basename(path);
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export function filePreviewKind(path: string): FilePreviewKind | null {
  const ext = extensionForPath(path);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

export function canPreviewFile(path: string): boolean {
  return filePreviewKind(path) !== null;
}

export function opensInPreviewByDefault(path: string): boolean {
  const kind = filePreviewKind(path);
  return kind === "image" || kind === "pdf" || kind === "audio" || kind === "video";
}
