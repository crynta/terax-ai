import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { MarkdownStack as MarkdownStackType } from "@/modules/markdown/MarkdownStack";

const MarkdownStackInner = lazy(() =>
  import("@/modules/markdown/MarkdownStack").then((m) => ({
    default: m.MarkdownStack,
  })),
);

type Props = ComponentProps<typeof MarkdownStackType>;

export function MarkdownStack(props: Props) {
  if (!props.tabs.some((tab) => tab.kind === "markdown" && !tab.cold))
    return null;
  return (
    <Suspense fallback={null}>
      <MarkdownStackInner {...props} />
    </Suspense>
  );
}
