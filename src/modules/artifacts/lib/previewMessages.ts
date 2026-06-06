type PreviewMessage = {
  source?: unknown;
  token?: unknown;
  type?: unknown;
  message?: unknown;
};

export function artifactPreviewRuntimeError(
  data: unknown,
  token: string,
): string | null {
  if (!data || typeof data !== "object") return null;
  const message = data as PreviewMessage;
  if (message.source !== "terax-artifact-preview") return null;
  if (message.token !== token) return null;
  if (message.type !== "error") return null;
  if (typeof message.message !== "string") return "Unknown preview error";
  const normalized = message.message.trim();
  return normalized.length > 0 ? normalized : "Unknown preview error";
}
