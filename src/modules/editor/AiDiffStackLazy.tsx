import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import type { AiDiffStack as AiDiffStackType } from "@/modules/editor/AiDiffStack";

const AiDiffStackInner = lazy(() =>
  import("@/modules/editor/AiDiffStack").then((m) => ({
    default: m.AiDiffStack,
  })),
);

type Props = ComponentProps<typeof AiDiffStackType>;

export function AiDiffStack(props: Props) {
  if (
    !props.tabs.some(
      (tab) => tab.kind === "ai-diff" && tab.id === props.activeId,
    )
  )
    return null;
  return (
    <Suspense fallback={null}>
      <AiDiffStackInner {...props} />
    </Suspense>
  );
}
