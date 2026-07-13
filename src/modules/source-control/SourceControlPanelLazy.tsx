import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import type { SourceControlPanel as SourceControlPanelType } from "./SourceControlPanel";

const SourceControlPanelInner = lazy(() =>
  import("./SourceControlPanel").then((m) => ({
    default: m.SourceControlPanel,
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
