export type PiCommandErrorLike = {
  message?: unknown;
  code?: unknown;
  category?: unknown;
  retryable?: unknown;
  remediation?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

export function formatPiErrorDetail(error: unknown): string {
  const message = errorMessage(error);
  if (!isRecord(error) || typeof error.remediation !== "string") {
    return message;
  }
  return `${message}\n${error.remediation}`;
}
