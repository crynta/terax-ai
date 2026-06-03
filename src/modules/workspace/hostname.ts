export function normalizeHostName(value: string | null | undefined): string {
  const trimmed = value?.trim().toLowerCase() ?? "";
  if (!trimmed) return "";
  return trimmed.replace(/\.local$/, "");
}

export function isLocalHost(remoteHost: string | null | undefined, localHost: string | null | undefined): boolean {
  const remote = normalizeHostName(remoteHost);
  const local = normalizeHostName(localHost);
  if (!remote || !local) return false;
  return remote === local;
}
