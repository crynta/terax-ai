import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import { PaneLoadingFallback } from "@/components/PaneLoadingFallback";
import type { GitHistoryStack as GitHistoryStackType } from "./GitHistoryStack";

const GitHistoryStackInner = lazy(() =>
  import("./GitHistoryStack").then((m) => ({ default: m.GitHistoryStack })),
);

type Props = ComponentProps<typeof GitHistoryStackType>;

export function GitHistoryStack(props: Props) {
  return (
    <Suspense fallback={<PaneLoadingFallback label="Loading Git history…" />}>
      <GitHistoryStackInner {...props} />
    </Suspense>
  );
}
