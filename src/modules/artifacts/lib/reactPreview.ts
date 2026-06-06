import { artifactsNative } from "@/modules/artifacts/lib/native";
import type { ReactCompileResult } from "@/modules/artifacts/lib/types";

type CompileReact = (content: string) => Promise<ReactCompileResult>;

export type ReactPreviewLoadResult =
  | {
      status: "ready";
      document: string;
      diagnostics: string[];
    }
  | {
      status: "error";
      diagnostics: string[];
    };

export async function loadReactPreviewDocument(
  content: string,
  compileReact: CompileReact = artifactsNative.compileReact,
): Promise<ReactPreviewLoadResult> {
  try {
    const result = await compileReact(content);
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

function normalizeCompilerDiagnostics(error: unknown): string[] {
  if (typeof error === "string" && error.trim().length > 0) {
    return [error];
  }

  if (error && typeof error === "object") {
    const message = "message" in error ? error.message : null;
    if (typeof message === "string" && message.trim().length > 0) {
      return [message];
    }

    const code = "code" in error ? error.code : null;
    if (typeof code === "string" && code.trim().length > 0) {
      return [code];
    }
  }

  return ["React preview compilation failed"];
}
