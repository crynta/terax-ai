import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { GitDiffStack as GitDiffStackType } from "./GitDiffStack";

const GitDiffStackInner = lazy(() =>
  import("./GitDiffStack").then((m) => ({ default: m.GitDiffStack })),
);

type Props = ComponentProps<typeof GitDiffStackType>;

export function GitDiffStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <GitDiffStackInner {...props} />
    </Suspense>
  );
}
