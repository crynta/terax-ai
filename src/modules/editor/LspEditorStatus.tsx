import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  useLspDebugStore,
  LSP_DEV_TOOLS,
  type LspSessionState,
} from "@/modules/editor/lib/lsp/debugStore";

const MESSAGES: Partial<Record<LspSessionState, string>> = {
  unsupported: "No language server configured for this file type.",
  spawning: "Starting language server…",
};

type Props = {
  path: string;
};

export function LspEditorStatus({ path }: Props) {
  const lspEnabled = usePreferencesStore((s) => s.lspEnabled);
  const state = useLspDebugStore((s) => s.session.state);
  const error = useLspDebugStore((s) => s.session.error);
  const lastPath = useLspDebugStore((s) => s.session.lastPath);
  const setPanelOpen = useLspDebugStore((s) => s.setPanelOpen);

  if (!lspEnabled || lastPath !== path) return null;
  if (state !== "error" && state !== "unsupported" && state !== "spawning") {
    return null;
  }

  const text =
    state === "error"
      ? (error ?? "Language server error.")
      : (MESSAGES[state] ?? null);
  if (!text) return null;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-3 border-b px-3 py-1.5 text-[11px]",
        state === "error" &&
          "border-destructive/30 bg-destructive/10 text-destructive",
        state === "unsupported" &&
          "border-border/60 bg-muted/40 text-muted-foreground",
        state === "spawning" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-400",
      )}
    >
      <span className="min-w-0 truncate">{text}</span>
      {state === "error" && LSP_DEV_TOOLS ? (
        <button
          type="button"
          className="shrink-0 underline underline-offset-2 hover:no-underline"
          onClick={() => setPanelOpen(true)}
        >
          Debug log
        </button>
      ) : null}
    </div>
  );
}
