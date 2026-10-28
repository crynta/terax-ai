import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import type { GitDiffStack as GitDiffStackType } from "@/modules/editor/GitDiffStack";

const GitDiffStackInner = lazy(() =>
  import("@/modules/editor/GitDiffStack").then((m) => ({
    default: m.GitDiffStack,
  })),
);

type Props = ComponentProps<typeof GitDiffStackType>;

export function GitDiffStack(props: Props) {
  if (
    !props.tabs.some(
      (tab) =>
        (tab.kind === "git-diff" || tab.kind === "git-commit-file") &&
        tab.id === props.activeId,
    )
  )
    return null;
  return (
    <Suspense fallback={null}>
      <GitDiffStackInner {...props} />
    </Suspense>
  );
}
