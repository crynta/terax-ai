import { diagnosticCount, forEachDiagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useDiagnosticsStore } from "./diagnosticsStore";

export function diagnosticsReporter(getPath: () => string): Extension {
  return EditorView.updateListener.of((update) => {
    if (
      !update.docChanged &&
      !update.transactions.some((tr) => tr.effects.length > 0)
    ) {
      return;
    }
    const total = diagnosticCount(update.state);
    let errors = 0;
    let warnings = 0;
    if (total > 0) {
      forEachDiagnostic(update.state, (d) => {
        if (d.severity === "error") errors += 1;
        else if (d.severity === "warning") warnings += 1;
      });
    }
    useDiagnosticsStore.getState().report(getPath(), { errors, warnings });
  });
}
