import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import { PaneLoadingFallback } from "@/components/PaneLoadingFallback";
import type { EditorStack as EditorStackType } from "./EditorStack";

const EditorStackInner = lazy(() =>
  import("./EditorStack").then((m) => ({ default: m.EditorStack })),
);

type Props = ComponentProps<typeof EditorStackType>;

export function EditorStack(props: Props) {
  return (
    <Suspense fallback={<PaneLoadingFallback label="Loading editor…" />}>
      <EditorStackInner {...props} />
    </Suspense>
  );
}
