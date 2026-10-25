import { cn, isHtmlPath } from "@/lib/utils";
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
  const markdowns = tabs.filter(
    (t): t is MarkdownTab => t.kind === "markdown" && !t.cold,
  );
  if (markdowns.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {markdowns.map((t) => {
        const visible = t.id === activeId;
        const Pane = isHtmlPath(t.path) ? HtmlPreviewPane : MarkdownPreviewPane;
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
              <Pane
                path={t.path}
                visible={visible}
                onSetView={(mode) => onSetMarkdownView(t.id, mode)}
              />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
}
