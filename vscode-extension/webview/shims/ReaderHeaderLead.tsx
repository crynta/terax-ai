import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { cn } from "@/lib/utils";
import { useSyncExternalStore } from "react";
import type { ReaderTheme } from "../../src/protocol";
import { hostState, onThemeChange, rpc } from "../bridge";

const subscribe = (notify: () => void) => onThemeChange(() => notify());
const current = (): ReaderTheme => hostState.env?.theme ?? "tokyo-night";

/**
 * The Claude icon at the start of the Reader header, as the theme switch:
 * Terax's own look (the default) or the active VS Code theme. The choice is
 * saved in the `teraxReader.theme` setting, so every Reader follows it.
 */
export function ReaderHeaderLead({ agent }: { agent: string }) {
  const theme = useSyncExternalStore(subscribe, current, current);
  const terax = theme === "tokyo-night";
  return (
    <button
      type="button"
      onClick={() =>
        void rpc("host_set_theme", { theme: terax ? "vscode" : "tokyo-night" })
      }
      aria-label={terax ? "Use the VS Code theme" : "Use the Terax theme"}
      title={
        terax
          ? "Terax theme · click for the VS Code theme"
          : "VS Code theme · click for the Terax theme"
      }
      className={cn(
        "relative grid size-7 shrink-0 place-items-center rounded-lg text-primary outline-none transition-colors hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-primary/40",
        terax ? "bg-primary/12" : "bg-foreground/[0.06]",
      )}
    >
      <AgentIcon agent={agent} size={15} />
      <span
        aria-hidden
        className={cn(
          "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-card",
          terax ? "bg-[#7aa2f7]" : "bg-muted-foreground",
        )}
      />
    </button>
  );
}
