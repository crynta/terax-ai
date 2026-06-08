import { lspDebugPatch, lspDebugPush } from "./debugStore";
import { useLspDiagnosticStore } from "./diagnosticStore";
import { shutdownAllLsp } from "./manager";

/** Stop all language servers, clear diagnostics, reset status UI. */
export async function disableLsp(): Promise<void> {
  await shutdownAllLsp();
  useLspDiagnosticStore.setState({ byPath: {} });
  lspDebugPatch({
    state: "idle",
    lastPath: null,
    command: null,
    args: [],
    cwd: null,
    rootUri: null,
    languageId: null,
    transportId: null,
    poolKey: null,
    diagnosticCount: 0,
    openDocuments: [],
    error: null,
  });
  lspDebugPush("info", "LSP disabled", "All language servers stopped.");
}
