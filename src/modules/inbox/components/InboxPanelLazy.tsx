import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import type { InboxPanel as InboxPanelType } from "./InboxPanel";

const InboxPanelInner = lazy(() =>
  import("./InboxPanel").then((module) => ({
    default: module.InboxPanel,
  })),
);

type Props = ComponentProps<typeof InboxPanelType>;

function InboxPanelFallback() {
  return (
    <aside
      aria-label="Inbox"
      className="flex h-full min-w-0 flex-col bg-card/80 backdrop-blur"
    >
      <header className="flex min-h-10 shrink-0 items-center border-b border-border/60 px-3">
        <h2 className="truncate text-sm font-semibold">Inbox</h2>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center px-3 text-xs text-muted-foreground">
        Loading inbox…
      </div>
    </aside>
  );
}

export function InboxPanel(props: Props) {
  return (
    <Suspense fallback={<InboxPanelFallback />}>
      <InboxPanelInner {...props} />
    </Suspense>
  );
}
