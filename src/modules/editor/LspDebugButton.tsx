import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  useLspDebugStore,
  LSP_DEV_TOOLS,
  type LspSessionState,
} from "@/modules/editor/lib/lsp/debugStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { SourceCodeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

const HINT: Record<LspSessionState, string> = {
  idle: "LSP idle. Open a supported editor file.",
  unsupported: "This file type has no LSP server mapping.",
  spawning: "Starting language server...",
  ready: "Language server connected.",
  error: "LSP error. Open debug for details.",
  closed: "LSP session closed.",
};

type Props = {
  editorActive: boolean;
};

export function LspDebugButton({ editorActive }: Props) {
  const lspEnabled = usePreferencesStore((s) => s.lspEnabled);
  const state = useLspDebugStore((s) => s.session.state);
  const error = useLspDebugStore((s) => s.session.error);
  const toggle = useLspDebugStore((s) => s.togglePanel);

  if (!LSP_DEV_TOOLS) return null;

  const displayState: LspSessionState =
    lspEnabled ? state : "idle";
  const active = lspEnabled && editorActive && displayState !== "idle";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!lspEnabled}
          className={cn(
            "h-6 gap-1 px-2 text-[10.5px] font-medium",
            lspEnabled &&
              displayState === "ready" &&
              "text-emerald-700 dark:text-emerald-400",
            lspEnabled && displayState === "error" && "text-destructive",
            lspEnabled &&
              displayState === "spawning" &&
              "text-amber-700 dark:text-amber-400",
            (!lspEnabled || (!active && displayState === "idle")) && "opacity-50",
          )}
          onClick={toggle}
        >
          <HugeiconsIcon icon={SourceCodeIcon} size={12} strokeWidth={2} />
          <span>LSP</span>
          {lspEnabled && displayState === "ready" ? (
            <span className="size-1.5 rounded-full bg-emerald-500" />
          ) : null}
          {lspEnabled && displayState === "error" ? (
            <span className="size-1.5 rounded-full bg-destructive" />
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 text-[11px]">
        {!lspEnabled
          ? "Language servers are off. Enable in Settings → General."
          : (error ?? HINT[displayState])}
        <span className="mt-1 block text-muted-foreground">
          Click for LSP debug log.
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
