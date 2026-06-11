import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { MarkdownStack as MarkdownStackType } from "./MarkdownStack";

const MarkdownStackInner = lazy(() =>
  import("./MarkdownStack").then((m) => ({ default: m.MarkdownStack })),
);

type Props = ComponentProps<typeof MarkdownStackType>;

export function MarkdownStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <MarkdownStackInner {...props} />
    </Suspense>
  );
}
