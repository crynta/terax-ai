import type { Tab, TabKind } from "@/modules/tabs/lib/tabs";
import { type ComponentType, lazy, Suspense } from "react";
import type { ViewProps } from "./types";

type ViewSpec = {
  // biome-ignore lint/suspicious/noExplicitAny: the registry narrows by kind.
  component: ComponentType<ViewProps<any>>;
  /**
   * Kept mounted while hidden (terminal buffers, editor undo, a loaded page).
   * Others mount only while shown and release everything when hidden.
   */
  keepAlive: boolean;
  /** Draws right up to its edges, so the card insets it. */
  inset?: boolean;
};

const Terminal = lazy(() =>
  import("./TerminalView").then((m) => ({ default: m.TerminalView })),
);
const Editor = lazy(() => import("./EditorView"));
const Preview = lazy(() => import("./PreviewView"));
const Markdown = lazy(() => import("./MarkdownView"));
const AiDiff = lazy(() => import("./AiDiffView"));
const GitDiff = lazy(() => import("./GitDiffView"));
const GitHistory = lazy(() => import("./GitHistoryView"));

const VIEWS: Record<TabKind, ViewSpec> = {
  terminal: { component: Terminal, keepAlive: true, inset: true },
  editor: { component: Editor, keepAlive: true },
  preview: { component: Preview, keepAlive: true },
  markdown: { component: Markdown, keepAlive: true },
  "ai-diff": { component: AiDiff, keepAlive: false },
  "git-diff": { component: GitDiff, keepAlive: false },
  "git-commit-file": { component: GitDiff, keepAlive: false },
  "git-history": { component: GitHistory, keepAlive: false },
};

export function viewSpec(kind: TabKind): ViewSpec {
  return VIEWS[kind];
}

/** Whether a tab's view is mounted: warm, and shown or kept alive. */
export function isMounted(tab: Tab, visible: boolean): boolean {
  if (tab.cold) return false;
  return visible || VIEWS[tab.kind].keepAlive;
}

export function View(props: ViewProps) {
  const { component: Component } = VIEWS[props.tab.kind];
  return (
    <Suspense fallback={null}>
      <Component {...props} />
    </Suspense>
  );
}
