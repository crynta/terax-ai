import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { NotebookStack as NotebookStackType } from "./NotebookStack";

const NotebookStackInner = lazy(() =>
  import("./NotebookStack").then((module) => ({
    default: module.NotebookStack,
  })),
);

type Props = ComponentProps<typeof NotebookStackType>;

export function NotebookStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <NotebookStackInner {...props} />
    </Suspense>
  );
}
