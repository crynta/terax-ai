import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import type { SourceControlPanel as SourceControlPanelType } from "./SourceControlPanel";

const SourceControlPanelInner = lazy(() =>
  import("./SourceControlPanel").then((m) => ({
    default: m.SourceControlPanel,
  })),
);

type Props = ComponentProps<typeof SourceControlPanelType>;

function SourceControlPanelFallback() {
  return (
    <aside
      aria-label="Source control"
      className="flex h-full min-w-0 flex-col bg-card/80 text-foreground"
    >
      <header className="flex min-h-10 shrink-0 items-center border-b border-border/60 px-3">
        <h2 className="truncate text-sm font-semibold">Source Control</h2>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center px-3 text-xs text-muted-foreground">
        Loading source control…
      </div>
    </aside>
  );
}

export function SourceControlPanel(props: Props) {
  return (
    <Suspense fallback={<SourceControlPanelFallback />}>
      <SourceControlPanelInner {...props} />
    </Suspense>
  );
}
