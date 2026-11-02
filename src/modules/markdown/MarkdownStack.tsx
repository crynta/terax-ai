import { cn, isHtmlPath } from "@/lib/utils";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import type { MarkdownTab, Tab } from "@/modules/tabs";
import { lazy, Suspense } from "react";

// Split so an HTML preview never pulls the markdown renderer and vice versa.
const MarkdownPreviewPane = lazy(() =>
  import("./MarkdownPreviewPane").then((m) => ({
    default: m.MarkdownPreviewPane,
  })),
);
const HtmlPreviewPane = lazy(() =>
  import("./HtmlPreviewPane").then((m) => ({ default: m.HtmlPreviewPane })),
);

type Props = {
  tabs: Tab[];
  activeId: number;
  onSetMarkdownView: (id: number, mode: "rendered" | "raw") => void;
};

export function MarkdownStack({ tabs, activeId, onSetMarkdownView }: Props) {
  const spaces = useSpaces((s) => s.spaces);
  const markdowns = tabs.filter(
    (t): t is MarkdownTab => t.kind === "markdown" && !t.cold,
  );
  if (markdowns.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {markdowns.map((t) => {
        const visible = t.id === activeId;
        const onSetView = (mode: "rendered" | "raw") =>
          onSetMarkdownView(t.id, mode);
        return (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <Suspense fallback={null}>
              {isHtmlPath(t.path) ? (
                <HtmlPreviewPane
                  path={t.path}
                  visible={visible}
                  // The tab's own space, not the active workspace.
                  env={spaces.find((sp) => sp.id === t.spaceId)?.env}
                  onSetView={onSetView}
                />
              ) : (
                <MarkdownPreviewPane
                  path={t.path}
                  visible={visible}
                  onSetView={onSetView}
                />
              )}
            </Suspense>
          </div>
        );
      })}
    </div>
  );
}
