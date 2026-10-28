import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import type { EditorStack as EditorStackType } from "@/modules/editor/EditorStack";

const EditorStackInner = lazy(() =>
  import("@/modules/editor/EditorStack").then((m) => ({
    default: m.EditorStack,
  })),
);

type Props = ComponentProps<typeof EditorStackType>;

export function EditorStack(props: Props) {
  if (!props.tabs.some((tab) => tab.kind === "editor" && !tab.cold))
    return null;
  return (
    <Suspense fallback={null}>
      <EditorStackInner {...props} />
    </Suspense>
  );
}
