import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { SourceControlMultiPanel as SourceControlPanelType } from "./SourceControlMultiPanel";

const SourceControlPanelInner = lazy(() =>
  import("./SourceControlMultiPanel").then((m) => ({
    default: m.SourceControlMultiPanel,
  })),
);

type Props = ComponentProps<typeof SourceControlPanelType>;

export function SourceControlPanel(props: Props) {
  return (
    <Suspense fallback={null}>
      <SourceControlPanelInner {...props} />
    </Suspense>
  );
}
