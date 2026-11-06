import { cn } from "@/lib/utils";
import { TabBar } from "@/modules/tabs/TabBar";
import {
  Cancel01Icon,
  Copy01Icon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  SquareIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  activateTab,
  cardTabIds,
  focusCard,
  newPreviewInCard,
  newTerminalInCard,
  pinTab,
  reorderTabInCard,
  setOverrideLanguage,
  splitOffTab,
  splitTerminal,
  toggleMaximize,
  updateTab,
} from "../actions";
import { useWorkbenchChrome } from "../chrome";
import type { DropZone } from "../model/dropZone";
import { cards, findCard } from "../model/layout";
import { tabById, taskById } from "../model/workbench";
import { useWorkbench } from "../store";
import { cardStyle, HEADER } from "./geometry";
import { tabDrag, useTabDrop } from "./tabDrag";

type Props = {
  taskId: number;
  cardId: number;
  /** The card's frame, as primitives so an unchanged card skips rendering. */
  x: number;
  y: number;
  w: number;
  h: number;
  focused: boolean;
  /** Several cards share the task, so focus needs a visible cue. */
  ringed: boolean;
  maximized: boolean;
};

const DROP_AREA: Record<DropZone, string> = {
  stack: "inset-0",
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
};

/** A card's header (its tab strip and controls), focus ring and drop overlay. */
export const CardChrome = memo(function CardChrome({
  taskId,
  cardId,
  x,
  y,
  w,
  h,
  focused,
  ringed,
  maximized,
}: Props) {
  const chrome = useWorkbenchChrome();
  const tabs = useWorkbench(
    useShallow((s) => {
      const layout = taskById(s, taskId)?.layout;
      const node = layout && findCard(layout, cardId);
      return node
        ? node.tabIds.flatMap((id) => {
            const tab = tabById(s, id);
            return tab ? [tab] : [];
          })
        : [];
    }),
  );
  const activeTabId = useWorkbench((s) => {
    const layout = taskById(s, taskId)?.layout;
    return (layout && findCard(layout, cardId)?.activeTabId) ?? -1;
  });
  const shape = useWorkbench(
    useShallow((s) => {
      const task = taskById(s, taskId);
      return {
        single: task ? cards(task.layout).length === 1 : true,
        main: task?.kind === "main",
      };
    }),
  );
  const drop = useTabDrop((s) =>
    s.target?.cardId === cardId ? s.target.zone : null,
  );
  if (tabs.length === 0) return null;

  const cwd = () => chrome.newTerminalCwd();
  // The last card of a main task keeps its last tab.
  const closable = !(shape.main && shape.single);

  return (
    <div
      className="pointer-events-none absolute"
      style={cardStyle({ x, y, w, h })}
    >
      <div
        role="toolbar"
        aria-label="Card"
        data-card-header={cardId}
        className={cn(
          "group/card pointer-events-auto absolute inset-x-px top-px flex items-center gap-1 border-b border-border/50 pr-1 pl-1.5 transition-colors duration-[var(--dur-fast)]",
          focused && ringed ? "bg-foreground/[0.025]" : "bg-transparent",
        )}
        style={{ height: HEADER - 1 }}
        onMouseDownCapture={() => {
          if (!focused) focusCard(taskId, cardId);
        }}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) toggleMaximize(taskId, cardId);
        }}
      >
        <TabBar
          tabs={tabs}
          activeId={activeTabId}
          closable={closable}
          compact
          externalDrag={tabDrag}
          onSelect={activateTab}
          onSplitOff={splitOffTab}
          onNew={() => newTerminalInCard(taskId, cardId, { cwd: cwd() })}
          onNewBlock={() =>
            newTerminalInCard(taskId, cardId, { cwd: cwd(), blocks: true })
          }
          onNewPrivate={() =>
            newTerminalInCard(taskId, cardId, { cwd: cwd(), private: true })
          }
          onNewPreview={() => newPreviewInCard(taskId, cardId)}
          onNewEditor={() => {
            focusCard(taskId, cardId);
            chrome.newEditor();
          }}
          onNewGitGraph={() => {
            focusCard(taskId, cardId);
            chrome.newGitGraph();
          }}
          onLaunchAgents={chrome.launchAgents}
          onClose={chrome.closeTab}
          onCloseTabsToRight={(id) => {
            const ids = cardTabIds(taskId, cardId);
            chrome.closeTabs("right", id, ids.slice(ids.indexOf(id) + 1));
          }}
          onCloseOtherTabs={(id) =>
            chrome.closeTabs(
              "other",
              id,
              cardTabIds(taskId, cardId).filter((other) => other !== id),
            )
          }
          onPin={pinTab}
          onRename={(id, title) => updateTab(id, { customTitle: title.trim() })}
          onReorder={reorderTabInCard}
          onOverrideLanguage={setOverrideLanguage}
        />
        <div className="h-full min-w-1 flex-1" />
        <div
          className={cn(
            "flex shrink-0 items-center gap-px transition-opacity duration-[var(--dur-fast)] group-hover/card:opacity-100 focus-within:opacity-100",
            focused ? "opacity-60" : "opacity-0",
          )}
        >
          <CardButton
            icon={LayoutTwoColumnIcon}
            label="Split right"
            onClick={() => splitTerminal("row", cwd(), { taskId, cardId })}
          />
          <CardButton
            icon={LayoutTwoRowIcon}
            label="Split down"
            onClick={() => splitTerminal("col", cwd(), { taskId, cardId })}
          />
          {!shape.single && (
            <CardButton
              icon={maximized ? Copy01Icon : SquareIcon}
              label={maximized ? "Restore" : "Maximize"}
              onClick={() => toggleMaximize(taskId, cardId)}
            />
          )}
          {closable && (
            <CardButton
              icon={Cancel01Icon}
              label="Close card"
              onClick={() => {
                const ids = cardTabIds(taskId, cardId);
                if (ids.length === 1) chrome.closeTab(ids[0]);
                else chrome.closeTabs("card", ids[0], ids);
              }}
            />
          )}
        </div>
      </div>
      {focused && ringed && (
        <div
          aria-hidden
          className="absolute inset-0 rounded-[var(--pane-radius)] ring-1 ring-primary/40 ring-inset"
        />
      )}
      {drop && (
        <div
          aria-hidden
          className="absolute inset-x-px bottom-px"
          style={{ top: HEADER }}
        >
          <div
            className={cn(
              "absolute rounded-md bg-primary/12 ring-1 ring-primary/45 ring-inset",
              DROP_AREA[drop],
            )}
          />
        </div>
      )}
    </div>
  );
});

function CardButton({
  icon,
  label,
  onClick,
}: {
  icon: IconSvgElement;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={1.75} />
    </button>
  );
}
