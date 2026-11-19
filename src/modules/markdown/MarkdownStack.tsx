import { cn } from "@/lib/utils";
import type { MarkdownTab, Tab } from "@/modules/tabs";
import { MarkdownPreviewPane } from "./MarkdownPreviewPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSetMarkdownView: (id: number, mode: "rendered" | "raw") => void;
};

/** The folder the explorer shows: the active terminal's cwd, else any terminal's. */
function workspaceRootOf(tabs: Tab[], activeId: number): string | null {
  const active = tabs.find((t) => t.id === activeId);
  if (active?.kind === "terminal" && active.cwd) return active.cwd;
  for (const t of tabs) if (t.kind === "terminal" && t.cwd) return t.cwd;
  return null;
}

export function MarkdownStack({ tabs, activeId, onSetMarkdownView }: Props) {
  const markdowns = tabs.filter(
    (t): t is MarkdownTab => t.kind === "markdown" && !t.cold,
  );
  if (markdowns.length === 0) return null;
  const workspaceRoot = workspaceRootOf(tabs, activeId);
  return (
    <div className="relative h-full w-full">
      {markdowns.map((t) => {
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
            <MarkdownPreviewPane
              path={t.path}
              workspaceRoot={workspaceRoot}
              visible={visible}
              onSetView={(mode) => onSetMarkdownView(t.id, mode)}
            />
          </div>
        );
      })}
    </div>
  );
}
