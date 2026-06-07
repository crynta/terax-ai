import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import { SidebarPanelBody, SidebarPanelFrame } from "@/modules/sidebar";
import type { InboxPanel as InboxPanelType } from "./InboxPanel";

const InboxPanelInner = lazy(() =>
  import("./InboxPanel").then((module) => ({
    default: module.InboxPanel,
  })),
);

type Props = ComponentProps<typeof InboxPanelType>;

function InboxPanelFallback() {
  return (
    <SidebarPanelFrame aria-label="Inbox">
      <header className="flex min-h-10 shrink-0 items-center border-b border-border/60 px-3">
        <h2 className="truncate text-sm font-semibold">Inbox</h2>
      </header>
      <SidebarPanelBody className="items-center justify-center px-3 text-xs text-muted-foreground">
        Loading inbox…
      </SidebarPanelBody>
    </SidebarPanelFrame>
  );
}

export function InboxPanel(props: Props) {
  return (
    <Suspense fallback={<InboxPanelFallback />}>
      <InboxPanelInner {...props} />
    </Suspense>
  );
}
