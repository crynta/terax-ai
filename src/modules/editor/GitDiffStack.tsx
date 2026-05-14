import { cn } from "@/lib/utils";
import type { GitDiffTab, Tab } from "@/modules/tabs";
import { GitDiffPane } from "./GitDiffPane";

type Props = {
  tabs: Tab[];
  activeId: number;
};

export function GitDiffStack({ tabs, activeId }: Props) {
  const diffs = tabs.filter((t): t is GitDiffTab => t.kind === "git-diff");
  if (diffs.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {diffs.map((t) => {
        const visible = t.id === activeId;
        return (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <GitDiffPane
              path={t.path}
              repoRoot={t.repoRoot}
              mode={t.mode}
              originalContent={t.originalContent}
              modifiedContent={t.modifiedContent}
              isBinary={t.isBinary}
              fallbackPatch={t.fallbackPatch}
            />
          </div>
        );
      })}
    </div>
  );
}
