import { cn } from "@/lib/utils";
import { TabIcon, type Tab } from "@/modules/tabs";
import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useMemo, useRef } from "react";

export type VerticalTabsPanelProps = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onNew: () => void;
};

const ROW_BASE = 32;
const PREVIEW_LINE_HEIGHT = 14;

function previewLines(tab: Tab): string[] {
  if (tab.kind !== "terminal" || !tab.previewText) return [];
  return tab.previewText.split("\n");
}

export function VerticalTabsPanel({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
}: VerticalTabsPanelProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const estimateSize = useCallback(
    (i: number) => {
      const tab = tabs[i];
      if (!tab) return ROW_BASE;
      const lines = previewLines(tab).length;
      return lines > 0 ? ROW_BASE + lines * PREVIEW_LINE_HEIGHT : ROW_BASE;
    },
    [tabs],
  );

  const rowVirtualizer = useVirtualizer({
    count: tabs.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 5,
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((vItem) => {
            const tab = tabs[vItem.index];
            if (!tab) return null;
            return (
              <TabRow
                key={tab.id}
                tab={tab}
                index={vItem.index}
                offset={vItem.start}
                isActive={tab.id === activeId}
                measureRef={rowVirtualizer.measureElement}
                onSelect={onSelect}
                onClose={onClose}
              />
            );
          })}
        </div>
      </div>
      <button
        type="button"
        onClick={onNew}
        className="flex w-full shrink-0 items-center gap-1.5 px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
      >
        <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
        New tab
      </button>
    </div>
  );
}

type TabRowProps = {
  tab: Tab;
  index: number;
  offset: number;
  isActive: boolean;
  measureRef: (node: Element | null) => void;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
};

function TabRow({
  tab,
  index,
  offset,
  isActive,
  measureRef,
  onSelect,
  onClose,
}: TabRowProps) {
  const lines = useMemo(() => previewLines(tab), [tab]);
  const isDirty = tab.kind === "editor" && tab.dirty;

  return (
    <div
      data-index={index}
      ref={measureRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        transform: `translateY(${offset}px)`,
      }}
      className={cn(
        "group flex min-h-8 cursor-pointer items-center gap-1.5 px-2 py-1 text-[11.5px] select-none",
        isActive
          ? "bg-foreground/[0.07] text-foreground"
          : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
      )}
      onClick={() => onSelect(tab.id)}
    >
      <TabIcon
        tab={tab}
        size={13}
        strokeWidth={1.75}
        iconClassName="shrink-0 text-muted-foreground"
        imageClassName="h-3.5 w-3.5 shrink-0"
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="truncate">{tab.title}</div>
        {lines.length > 0 && (
          <div className="mt-0.5 space-y-px">
            {lines.map((line, i) => (
              <div
                key={i}
                className="truncate font-mono text-[10px] text-muted-foreground/60"
              >
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
      {isDirty && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/50" />
      )}
      <button
        type="button"
        aria-label="Close tab"
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.id);
        }}
        className="invisible shrink-0 rounded p-0.5 text-muted-foreground/60 hover:bg-foreground/10 hover:text-foreground group-hover:visible"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
      </button>
    </div>
  );
}
