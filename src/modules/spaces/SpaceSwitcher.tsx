import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  arrayMove,
  CSS,
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  SortableContext,
  sortableKeyboardCoordinates,
  useSensor,
  useSensors,
  useSortable,
  verticalListSortingStrategy,
} from "@/modules/dnd";
import { useShortcutLabel } from "@/modules/shortcuts";
import { labelFor, type Tab, TabIcon } from "@/modules/tabs";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { InlineRename } from "./components/InlineRename";
import { accentFor } from "./lib/spaceColor";
import type { SpaceMeta } from "./lib/store";
import { useSpaces } from "./lib/useSpaces";
import { SpaceAvatar } from "./SpaceAvatar";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: Tab[];
  onNewSpace: () => void;
  onDeleteSpace: (id: string) => void;
  onNewTabInSpace: (spaceId: string) => void;
  onJumpTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  onMoveTabToSpace: (tabId: number, spaceId: string) => void;
  onReorderTab: (
    tabId: number,
    targetTabId: number,
    edge: "top" | "bottom",
  ) => void;
  onReorderSpaces: (orderedIds: string[]) => void;
};

const sid = (id: string) => `S:${id}`;
const tid = (id: number) => `T:${id}`;

type ActiveDrag =
  | { kind: "space"; space: SpaceMeta }
  | { kind: "tab"; tab: Tab }
  | null;

function subtitleFor(tab: Tab): string | null {
  if (tab.kind === "terminal") {
    if (!tab.cwd) return null;
    const segs = tab.cwd.split(/[\\/]/).filter(Boolean);
    return segs.slice(-2).join("/") || tab.cwd;
  }
  if (tab.kind === "editor" || tab.kind === "markdown") {
    const segs = tab.path.split(/[\\/]/).filter(Boolean);
    return segs.slice(-2, -1)[0] ?? null;
  }
  return null;
}

export function SpaceSwitcher({
  open,
  onOpenChange,
  tabs,
  onNewSpace,
  onDeleteSpace,
  onNewTabInSpace,
  onJumpTab,
  onCloseTab,
  onMoveTabToSpace,
  onReorderTab,
  onReorderSpaces,
}: Props) {
  const spaces = useSpaces((s) => s.spaces);
  const activeId = useSpaces((s) => s.activeId);
  const setActive = useSpaces((s) => s.setActive);
  const rename = useSpaces((s) => s.rename);
  const shortcut = useShortcutLabel("space.overview");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [active, setActiveDrag] = useState<ActiveDrag>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    activeId ? new Set([activeId]) : new Set(),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const current = spaces.find((s) => s.id === activeId);

  const tabsBySpace = useMemo(() => {
    const m = new Map<string, Tab[]>();
    for (const t of tabs) {
      const arr = m.get(t.spaceId);
      if (arr) arr.push(t);
      else m.set(t.spaceId, [t]);
    }
    return m;
  }, [tabs]);

  useEffect(() => {
    if (!open || !activeId) return;
    setExpanded((prev) =>
      prev.has(activeId) ? prev : new Set(prev).add(activeId),
    );
  }, [open, activeId]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current;
    if (data?.kind === "space") {
      const sp = spaces.find((s) => s.id === data.spaceId);
      if (sp) setActiveDrag({ kind: "space", space: sp });
    } else if (data?.kind === "tab") {
      const tab = tabs.find((t) => t.id === data.tabId);
      if (tab) setActiveDrag({ kind: "tab", tab });
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    const { active: a, over } = e;
    if (!over) return;
    const ad = a.data.current;
    const od = over.data.current;
    if (!ad || !od || a.id === over.id) return;

    if (ad.kind === "space") {
      if (od.kind === "space") {
        const ids = spaces.map((s) => s.id);
        const from = ids.indexOf(ad.spaceId);
        const to = ids.indexOf(od.spaceId);
        if (from >= 0 && to >= 0) onReorderSpaces(arrayMove(ids, from, to));
      }
      return;
    }

    // dragging a tab
    if (od.kind === "space") {
      onMoveTabToSpace(ad.tabId, od.spaceId);
    } else if (od.kind === "tab") {
      const list = tabsBySpace.get(od.spaceId) ?? [];
      const oi = list.findIndex((t) => t.id === od.tabId);
      const ai = list.findIndex((t) => t.id === ad.tabId);
      const edge = ai >= 0 && ai < oi ? "bottom" : "top";
      onReorderTab(ad.tabId, od.tabId, edge);
    }
  };

  if (!current) return null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={shortcut ? `Spaces · ${shortcut}` : "Spaces"}
          className="flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: accentFor(current) }}
          />
          <span className="max-w-36 truncate text-xs font-medium">
            {current.name}
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={13}
            strokeWidth={1.75}
            className="shrink-0 opacity-60"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[20rem] p-1.5">
        <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
          <span className="text-xs font-semibold text-foreground">Spaces</span>
          {shortcut && (
            <Kbd className="h-5 bg-muted/70 text-[10px]">{shortcut}</Kbd>
          )}
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveDrag(null)}
        >
          <div className="-mx-0.5 max-h-[60vh] overflow-y-auto px-0.5">
            <SortableContext
              items={spaces.map((s) => sid(s.id))}
              strategy={verticalListSortingStrategy}
            >
              {spaces.map((sp) => (
                <SpaceRow
                  key={sp.id}
                  space={sp}
                  tabs={tabsBySpace.get(sp.id) ?? []}
                  isActive={sp.id === activeId}
                  canDelete={spaces.length > 1}
                  expanded={expanded.has(sp.id)}
                  editing={editingId === sp.id}
                  draggingTabFromOther={
                    active?.kind === "tab" && active.tab.spaceId !== sp.id
                  }
                  onToggle={() => toggleExpand(sp.id)}
                  onSwitch={() => {
                    setActive(sp.id);
                    onOpenChange(false);
                  }}
                  onStartRename={() => setEditingId(sp.id)}
                  onCommitRename={(name) => {
                    const v = name.trim();
                    if (v) rename(sp.id, v);
                    setEditingId(null);
                  }}
                  onCancelRename={() => setEditingId(null)}
                  onDelete={() => onDeleteSpace(sp.id)}
                  onNewTab={() => onNewTabInSpace(sp.id)}
                  onJumpTab={onJumpTab}
                  onCloseTab={onCloseTab}
                />
              ))}
            </SortableContext>
          </div>
          <DragOverlay>
            {active?.kind === "space" ? (
              <OverlayChip
                color={accentFor(active.space)}
                label={active.space.name}
              />
            ) : active?.kind === "tab" ? (
              <OverlayChip tab={active.tab} label={labelFor(active.tab)} />
            ) : null}
          </DragOverlay>
        </DndContext>
        <div className="mt-1.5 border-t border-border/60 pt-1.5">
          <button
            type="button"
            onClick={onNewSpace}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={1.75} />
            <span className="flex-1">New space</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type SpaceRowProps = {
  space: SpaceMeta;
  tabs: Tab[];
  isActive: boolean;
  canDelete: boolean;
  expanded: boolean;
  editing: boolean;
  draggingTabFromOther: boolean;
  onToggle: () => void;
  onSwitch: () => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onNewTab: () => void;
  onJumpTab: (id: number) => void;
  onCloseTab: (id: number) => void;
};

function SpaceRow({
  space,
  tabs,
  isActive,
  canDelete,
  expanded,
  editing,
  draggingTabFromOther,
  onToggle,
  onSwitch,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onNewTab,
  onJumpTab,
  onCloseTab,
}: SpaceRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: sid(space.id),
    data: { kind: "space", spaceId: space.id },
    disabled: editing,
  });

  const moveTarget = isOver && draggingTabFromOther;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 opacity-50")}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: sortable row hosts nested buttons */}
      <div
        {...attributes}
        {...listeners}
        onClick={editing ? undefined : onSwitch}
        onKeyDown={(e) => {
          if (editing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            onSwitch();
            return;
          }
          listeners?.onKeyDown?.(e);
        }}
        className={cn(
          "group relative flex cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
          moveTarget
            ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
            : isActive
              ? "bg-accent"
              : "hover:bg-accent/50",
        )}
      >
        <button
          type="button"
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground"
        >
          <HugeiconsIcon
            icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
            size={13}
            strokeWidth={2}
          />
        </button>
        <SpaceAvatar space={space} size="sm" active={isActive} />
        {editing ? (
          <InlineRename
            initial={space.name}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
            className="ml-0.5"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {space.name}
          </span>
        )}
        {!editing && (
          <>
            <span className="shrink-0 px-1 text-[10px] tabular-nums text-muted-foreground/50 group-hover:hidden">
              {tabs.length}
            </span>
            <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
              <RowAction
                icon={PencilEdit02Icon}
                label="Rename space"
                onClick={onStartRename}
              />
              <RowAction
                icon={PlusSignIcon}
                label="New tab"
                onClick={onNewTab}
              />
              {canDelete && (
                <RowAction
                  icon={Delete02Icon}
                  label="Delete space"
                  destructive
                  onClick={onDelete}
                />
              )}
            </div>
          </>
        )}
      </div>

      {expanded && (
        <SortableContext
          items={tabs.map((t) => tid(t.id))}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-px py-0.5 pl-10 pr-0.5">
            {tabs.map((t) => (
              <TabRow
                key={t.id}
                tab={t}
                onJump={() => onJumpTab(t.id)}
                onClose={() => onCloseTab(t.id)}
              />
            ))}
            {tabs.length === 0 && (
              <span className="px-2 py-1 text-[10.5px] text-muted-foreground/50">
                No tabs
              </span>
            )}
          </div>
        </SortableContext>
      )}
    </div>
  );
}

function TabRow({
  tab,
  onJump,
  onClose,
}: {
  tab: Tab;
  onJump: () => void;
  onClose: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: tid(tab.id),
    data: { kind: "tab", tabId: tab.id, spaceId: tab.spaceId },
  });
  const subtitle = subtitleFor(tab);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: sortable row hosts a nested close button
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onJump}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onJump();
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
      className={cn(
        "group/tab relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-primary/40",
        isDragging && "z-10 opacity-50",
      )}
    >
      <TabIcon tab={tab} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11.5px] leading-tight">
          {labelFor(tab)}
        </span>
        {subtitle && (
          <span className="truncate text-[9.5px] leading-tight text-muted-foreground/55">
            {subtitle}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Close tab"
        className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/tab:opacity-70 hover:opacity-100"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

function OverlayChip({
  tab,
  color,
  label,
}: {
  tab?: Tab;
  color?: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-popover px-2 py-1.5 text-xs shadow-lg">
      {tab ? (
        <TabIcon tab={tab} />
      ) : (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="max-w-44 truncate font-medium">{label}</span>
    </div>
  );
}

function RowAction({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: typeof Delete02Icon;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors",
        destructive
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-accent hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
    </button>
  );
}
