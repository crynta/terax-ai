import { artifactsNative } from "@/modules/artifacts/lib/native";
import type {
  ArtifactDiagnostic,
  ArtifactDiagnosticSeverity,
  ReactCompileResult,
} from "@/modules/artifacts/lib/types";

type CompileReact = (
  content: string,
  previewToken?: string | null,
) => Promise<ReactCompileResult>;

export type ReactPreviewLoadResult =
  | {
      status: "ready";
      document: string;
      diagnostics: ArtifactDiagnostic[];
    }
  | {
      status: "error";
      diagnostics: ArtifactDiagnostic[];
    };

export async function loadReactPreviewDocument(
  content: string,
  previewToken?: string | null,
  compileReact: CompileReact = artifactsNative.compileReact,
): Promise<ReactPreviewLoadResult> {
  try {
    const result = await compileReact(content, previewToken ?? null);
    return {
      status: "ready",
      document: result.document,
      diagnostics: result.diagnostics,
    };
  } catch (error) {
    return {
      status: "error",
      diagnostics: normalizeCompilerDiagnostics(error),
    };
  }
}

function normalizeCompilerDiagnostics(error: unknown): ArtifactDiagnostic[] {
  if (error && typeof error === "object") {
    const diagnostics = "diagnostics" in error ? error.diagnostics : null;
    if (Array.isArray(diagnostics)) {
      const normalized = diagnostics
        .map(normalizeDiagnostic)
        .filter((diagnostic) => diagnostic !== null);
      if (normalized.length > 0) return normalized;
    }

    const message = "message" in error ? error.message : null;
    if (typeof message === "string" && message.trim().length > 0) {
      return [fallbackDiagnostic(message)];
    }

    const code = "code" in error ? error.code : null;
    if (typeof code === "string" && code.trim().length > 0) {
      return [fallbackDiagnostic(code)];
    }
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return [fallbackDiagnostic(error)];
  }

  return [fallbackDiagnostic("React preview compilation failed")];
}

function normalizeDiagnostic(value: unknown): ArtifactDiagnostic | null {
  if (!value || typeof value !== "object") return null;
  const message = "message" in value ? value.message : null;
  if (typeof message !== "string" || message.trim().length === 0) return null;
  const code =
    "code" in value && typeof value.code === "string"
      ? value.code
      : "ARTIFACT_REACT_DIAGNOSTIC";
  const severity = normalizeSeverity(
    "severity" in value ? value.severity : null,
  );
  return {
    code,
    severity,
    message,
    line: numberOrNull("line" in value ? value.line : null),
    column: numberOrNull("column" in value ? value.column : null),
    endLine: numberOrNull("endLine" in value ? value.endLine : null),
    endColumn: numberOrNull("endColumn" in value ? value.endColumn : null),
    excerpt:
      "excerpt" in value && typeof value.excerpt === "string"
        ? value.excerpt
        : null,
  };
}

function normalizeSeverity(value: unknown): ArtifactDiagnosticSeverity {
  return value === "warning" || value === "info" ? value : "error";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fallbackDiagnostic(message: string): ArtifactDiagnostic {
  return {
    code: "ARTIFACT_REACT_COMPILE",
    severity: "error",
    message,
    line: null,
    column: null,
    endLine: null,
    endColumn: null,
    excerpt: null,
  };
}
