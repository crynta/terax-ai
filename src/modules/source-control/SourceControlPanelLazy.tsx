import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import { SidebarPanelBody, SidebarPanelFrame } from "@/modules/sidebar";
import type { SourceControlPanel as SourceControlPanelType } from "./SourceControlPanel";

const SourceControlPanelInner = lazy(() =>
  import("./SourceControlPanel").then((m) => ({
    default: m.SourceControlPanel,
  })),
);

type Props = ComponentProps<typeof SourceControlPanelType>;

function SourceControlPanelFallback() {
  return (
    <SidebarPanelFrame aria-label="Source control" className="text-foreground">
      <header className="flex min-h-10 shrink-0 items-center border-b border-border/60 px-3">
        <h2 className="truncate text-sm font-semibold">Source Control</h2>
      </header>
      <SidebarPanelBody className="items-center justify-center px-3 text-xs text-muted-foreground">
        Loading source control…
      </SidebarPanelBody>
    </SidebarPanelFrame>
  );
}

export function SourceControlPanel(props: Props) {
  return (
    <Suspense fallback={<SourceControlPanelFallback />}>
      <SourceControlPanelInner {...props} />
    </Suspense>
  );
}
