import type { ReactNode } from "react";
import { AiInputBar, AiInputBarConnect } from "@/modules/ai/components/lazy";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";

type AppComposerDockProps = {
  /** The workspace surface stack rendered above the docked composer. */
  children: ReactNode;
  /** AI keys have finished loading; only then is the composer dock rendered. */
  keysLoaded: boolean;
  /** The AI panel is open (the dock animates in; otherwise it collapses to h-0). */
  panelOpen: boolean;
  /** A provider/composer is configured; otherwise show the connect affordance. */
  hasComposer: boolean;
};

/**
 * The workspace column: the active surface stack with the AI input bar docked
 * beneath it. The dock is kept mounted (not unmounted) when collapsed so the
 * composer state and focus survive panel toggles; it is hidden via height +
 * `inert` instead.
 */
export function AppComposerDock({
  children,
  keysLoaded,
  panelOpen,
  hasComposer,
}: AppComposerDockProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">{children}</div>

      {keysLoaded ? (
        <div
          data-ai-input-bar
          className={`overflow-hidden ${panelOpen ? "" : "h-0"}`}
          aria-hidden={!panelOpen}
          inert={panelOpen ? undefined : true}
        >
          <div
            className={`transition-[opacity,transform] duration-150 ease-out ${
              panelOpen
                ? "translate-y-0 opacity-100"
                : "translate-y-1 opacity-0"
            }`}
          >
            {hasComposer ? (
              <AiInputBar />
            ) : (
              <AiInputBarConnect
                onAdd={() => void openSettingsWindow("models")}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
