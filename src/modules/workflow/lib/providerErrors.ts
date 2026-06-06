export type WorkflowProviderErrorCode =
  | "auth"
  | "cancelled"
  | "quota"
  | "timeout"
  | "unknown";

export type WorkflowProviderFailure = {
  code: WorkflowProviderErrorCode;
  message: string;
  retryable: boolean;
};

export function classifyWorkflowProviderError(
  error: unknown,
  signal?: AbortSignal,
): WorkflowProviderFailure {
  if (isAbortError(error, signal)) {
    return {
      code: "cancelled",
      message: "Execution cancelled",
      retryable: false,
    };
  }

  const message = errorMessage(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("429") ||
    normalized.includes("quota") ||
    normalized.includes("rate limit") ||
    normalized.includes("ratelimit")
  ) {
    return {
      code: "quota",
      message: "Provider quota or rate limit exceeded",
      retryable: true,
    };
  }

  if (
    normalized.includes("no api key configured") ||
    normalized.includes("missing api key")
  ) {
    return {
      code: "auth",
      message,
      retryable: false,
    };
  }

  if (
    normalized.includes("401") ||
    normalized.includes("403") ||
    normalized.includes("api key") ||
    normalized.includes("auth") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden")
  ) {
    return {
      code: "auth",
      message: "Provider authentication failed",
      retryable: false,
    };
  }

  if (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    errorName(error) === "TimeoutError"
  ) {
    return {
      code: "timeout",
      message: "Provider request timed out",
      retryable: true,
    };
  }

  return {
    code: "unknown",
    message,
    retryable: true,
  };
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  const message = String(error);
  return message.trim().length > 0 ? message : "Provider execution failed";
}

function errorName(error: unknown): string | null {
  return error instanceof Error ? error.name : null;
}
