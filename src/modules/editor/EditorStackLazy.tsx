import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { EditorStack as EditorStackType } from "./EditorStack";

const EditorStackInner = lazy(() =>
  import("./EditorStack").then((m) => ({ default: m.EditorStack })),
);

type Props = ComponentProps<typeof EditorStackType>;

export function EditorStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <EditorStackInner {...props} />
    </Suspense>
  );
}
