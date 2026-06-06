import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";

const ModelComparePanelInner = lazy(() =>
  import("./ModelComparePanel").then((module) => ({
    default: module.ModelComparePanel,
  })),
);

function ModelCompareFallback() {
  return (
    <aside
      aria-label="Model compare"
      className="flex h-full min-h-0 flex-col bg-card/80 text-foreground"
    >
      <div className="border-b border-border/60 px-3 py-2 text-sm font-semibold">
        Model Compare
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-3 text-xs text-muted-foreground">
        Loading model compare…
      </div>
    </aside>
  );
}

type ModelComparePanelProps = ComponentProps<typeof ModelComparePanelInner>;

export function ModelComparePanel(props: ModelComparePanelProps) {
  return (
    <Suspense fallback={<ModelCompareFallback />}>
      <ModelComparePanelInner {...props} />
    </Suspense>
  );
}
