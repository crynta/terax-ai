import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import { SidebarPanelBody, SidebarPanelFrame } from "@/modules/sidebar";

const ModelComparePanelInner = lazy(() =>
  import("./ModelComparePanel").then((module) => ({
    default: module.ModelComparePanel,
  })),
);

function ModelCompareFallback() {
  return (
    <SidebarPanelFrame aria-label="Model compare" className="text-foreground">
      <div className="border-b border-border/60 px-3 py-2 text-sm font-semibold">
        Model Compare
      </div>
      <SidebarPanelBody className="items-center justify-center px-3 text-xs text-muted-foreground">
        Loading model compare…
      </SidebarPanelBody>
    </SidebarPanelFrame>
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
