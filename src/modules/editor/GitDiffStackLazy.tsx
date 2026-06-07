import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import { PaneLoadingFallback } from "@/components/PaneLoadingFallback";
import type { GitDiffStack as GitDiffStackType } from "./GitDiffStack";

const GitDiffStackInner = lazy(() =>
  import("./GitDiffStack").then((m) => ({ default: m.GitDiffStack })),
);

type Props = ComponentProps<typeof GitDiffStackType>;

export function GitDiffStack(props: Props) {
  return (
    <Suspense fallback={<PaneLoadingFallback label="Loading Git diff…" />}>
      <GitDiffStackInner {...props} />
    </Suspense>
  );
}
