import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import type { GitHistoryStack as GitHistoryStackType } from "./GitHistoryStack";

const GitHistoryStackInner = lazy(() =>
  import("./GitHistoryStack").then((m) => ({ default: m.GitHistoryStack })),
);

type Props = ComponentProps<typeof GitHistoryStackType>;

export function GitHistoryStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <GitHistoryStackInner {...props} />
    </Suspense>
  );
}
