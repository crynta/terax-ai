import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import { PaneLoadingFallback } from "@/components/PaneLoadingFallback";
import type { WorkflowStack as WorkflowStackType } from "./WorkflowStack";

const WorkflowStackInner = lazy(() =>
  import("./WorkflowStack").then((module) => ({
    default: module.WorkflowStack,
  })),
);

type Props = ComponentProps<typeof WorkflowStackType>;

export function WorkflowStack(props: Props) {
  return (
    <Suspense fallback={<PaneLoadingFallback label="Loading workflow…" />}>
      <WorkflowStackInner {...props} />
    </Suspense>
  );
}
