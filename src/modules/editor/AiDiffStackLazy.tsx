import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { AiDiffStack as AiDiffStackType } from "./AiDiffStack";

const AiDiffStackInner = lazy(() =>
  import("./AiDiffStack").then((m) => ({ default: m.AiDiffStack })),
);

type Props = ComponentProps<typeof AiDiffStackType>;

export function AiDiffStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <AiDiffStackInner {...props} />
    </Suspense>
  );
}
