import { lazy, Suspense } from "react";
import type { SessionsPanelProps } from "./SessionsPanel";

const SessionsPanelInner = lazy(() =>
  import("./SessionsPanel").then((m) => ({ default: m.SessionsPanel })),
);

export function SessionsPanel(props: SessionsPanelProps) {
  return (
    <Suspense fallback={null}>
      <SessionsPanelInner {...props} />
    </Suspense>
  );
}
