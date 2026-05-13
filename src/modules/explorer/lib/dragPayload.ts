export const TERAX_PATH_MIME = "application/x-terax-path";

export function writePathDragPayload(
  dataTransfer: DataTransfer,
  path: string,
): void {
  dataTransfer.setData("text/plain", path);
  dataTransfer.setData(TERAX_PATH_MIME, path);
  dataTransfer.effectAllowed = "copyLink";
}

export function readPathDragPayload(dataTransfer: DataTransfer): string[] {
  const custom = dataTransfer.getData(TERAX_PATH_MIME);
  if (custom) return splitPathPayload(custom);

  if (Array.from(dataTransfer.types).includes(TERAX_PATH_MIME)) {
    return [];
  }

  return splitPathPayload(dataTransfer.getData("text/plain"));
}

function splitPathPayload(payload: string): string[] {
  return payload
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
}
