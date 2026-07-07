import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
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

type Edge = "top" | "bottom";

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  kind: "space" | "tab";
  id: string | number;
  active: boolean;
};

type DropTarget =
  | { kind: "space"; spaceId: string; edge: Edge }
  | { kind: "tab"; tabId: number; edge: Edge }
  | { kind: "into-space"; spaceId: string };

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
  const { t } = useTranslation("spaces");
  const spaces = useSpaces((s) => s.spaces);
  const activeId = useSpaces((s) => s.activeId);
  const setActive = useSpaces((s) => s.setActive);
  const rename = useSpaces((s) => s.rename);
  const shortcut = useShortcutLabel("space.overview");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    activeId ? new Set([activeId]) : new Set(),
  );

  const drag = useRef<DragState | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  const [dragging, setDragging] = useState<{
    kind: "space" | "tab";
    id: string | number;
  } | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [overlay, setOverlay] = useState<{ x: number; y: number } | null>(null);

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

  const draggedTab =
    dragging?.kind === "tab"
      ? (tabs.find((t) => t.id === dragging.id) ?? null)
      : null;
  const draggedSpace =
    dragging?.kind === "space"
      ? (spaces.find((s) => s.id === dragging.id) ?? null)
      : null;

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

  const endDrag = (el: Element) => {
    const st = drag.current;
    if (st) el.releasePointerCapture?.(st.pointerId);
    drag.current = null;
    dropRef.current = null;
    setDragging(null);
    setDrop(null);
    setOverlay(null);
    document.body.style.userSelect = "";
  };

  const onPointerDown = (
    e: React.PointerEvent,
    kind: "space" | "tab",
    id: string | number,
  ) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      kind,
      id,
      active: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const st = drag.current;
    if (!st || st.pointerId !== e.pointerId) return;
    if (!st.active) {
      if (Math.hypot(e.clientX - st.startX, e.clientY - st.startY) < 5) return;
      st.active = true;
      setDragging({ kind: st.kind, id: st.id });
      document.body.style.userSelect = "none";
    }
    e.preventDefault();
    setOverlay({ x: e.clientX, y: e.clientY });

    const hit = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest("[data-drop]");
    if (!hit) {
      dropRef.current = null;
      setDrop(null);
      return;
    }
    const rect = hit.getBoundingClientRect();
    const edge: Edge = e.clientY < rect.top + rect.height / 2 ? "top" : "bottom";
    const kind = hit.getAttribute("data-drop");
    let next: DropTarget | null = null;
    if (st.kind === "space") {
      if (kind === "space") {
        const spaceId = hit.getAttribute("data-space-id");
        if (spaceId && spaceId !== st.id) next = { kind: "space", spaceId, edge };
      }
    } else if (kind === "tab") {
      const tabId = Number(hit.getAttribute("data-tab-id"));
      if (tabId !== st.id) next = { kind: "tab", tabId, edge };
    } else if (kind === "space") {
      const spaceId = hit.getAttribute("data-space-id");
      if (spaceId) next = { kind: "into-space", spaceId };
    }
    dropRef.current = next;
    setDrop(next);
  };

  const commit = () => {
    const st = drag.current;
    const dt = dropRef.current;
    if (!st?.active || !dt) return;
    if (st.kind === "space" && dt.kind === "space") {
      const without = spaces.map((s) => s.id).filter((id) => id !== st.id);
      let idx = without.indexOf(dt.spaceId);
      if (idx < 0) return;
      if (dt.edge === "bottom") idx += 1;
      without.splice(idx, 0, st.id as string);
      onReorderSpaces(without);
    } else if (st.kind === "tab") {
      if (dt.kind === "tab") onReorderTab(st.id as number, dt.tabId, dt.edge);
      else if (dt.kind === "into-space")
        onMoveTabToSpace(st.id as number, dt.spaceId);
    }
  };

  const onPointerUp = (e: React.PointerEvent, onActivate?: () => void) => {
    const st = drag.current;
    if (st?.active) commit();
    else if (st) onActivate?.();
    endDrag(e.currentTarget);
  };

  if (!current) return null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={shortcut ? t("titleWithShortcut", { shortcut }) : t("title")}
          className="flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-muted-foreground/90 outline-none transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <span className="max-w-36 truncate text-xs font-medium">
            {current.name}
          </span>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={14}
            strokeWidth={1.75}
            className="shrink-0 opacity-65"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[20rem] p-1.5">
        <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
          <span className="text-xs font-semibold text-foreground">
            {t("heading")}
          </span>
          {shortcut && (
            <Kbd className="h-5 bg-muted/70 text-[10px]">{shortcut}</Kbd>
          )}
        </div>
        <div className="-mx-0.5 max-h-[60vh] overflow-y-auto px-0.5">
          {spaces.map((sp) => (
            <SpaceRow
              key={sp.id}
              space={sp}
              tabs={tabsBySpace.get(sp.id) ?? []}
              isActive={sp.id === activeId}
              canDelete={spaces.length > 1}
              expanded={expanded.has(sp.id)}
              editing={editingId === sp.id}
              dragging={dragging}
              drop={drop}
              draggingTabFromOther={
                draggedTab !== null && draggedTab.spaceId !== sp.id
              }
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
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
        </div>
        <div className="mt-1.5 border-t border-border/60 pt-1.5">
          <button
            type="button"
            onClick={onNewSpace}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={1.75} />
            <span className="flex-1">{t("newSpace")}</span>
          </button>
        </div>
      </PopoverContent>
      {overlay &&
        (draggedSpace || draggedTab) &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[60]"
            style={{ left: overlay.x + 12, top: overlay.y + 8 }}
          >
            {draggedSpace ? (
              <OverlayChip
                color={accentFor(draggedSpace)}
                label={draggedSpace.name}
              />
            ) : draggedTab ? (
              <OverlayChip tab={draggedTab} label={labelFor(draggedTab)} />
            ) : null}
          </div>,
          document.body,
        )}
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
  dragging: { kind: "space" | "tab"; id: string | number } | null;
  drop: DropTarget | null;
  draggingTabFromOther: boolean;
  onPointerDown: (
    e: React.PointerEvent,
    kind: "space" | "tab",
    id: string | number,
  ) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent, onActivate?: () => void) => void;
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
  dragging,
  drop,
  draggingTabFromOther,
  onPointerDown,
  onPointerMove,
  onPointerUp,
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
  const { t } = useTranslation("spaces");
  const isDragging = dragging?.kind === "space" && dragging.id === space.id;
  const moveTarget = drop?.kind === "into-space" && drop.spaceId === space.id;
  const reorderEdge =
    drop?.kind === "space" && drop.spaceId === space.id ? drop.edge : null;

  return (
    <div className={cn("relative", isDragging && "opacity-50")}>
      {reorderEdge && <DropLine edge={reorderEdge} />}
      {/* biome-ignore lint/a11y/useSemanticElements: drag row hosts nested buttons, cannot be a <button> */}
      <div
        data-drop="space"
        data-space-id={space.id}
        role="button"
        tabIndex={editing ? -1 : 0}
        onPointerDown={editing ? undefined : (e) => onPointerDown(e, "space", space.id)}
        onPointerMove={onPointerMove}
        onPointerUp={editing ? undefined : (e) => onPointerUp(e, onSwitch)}
        onPointerCancel={(e) => onPointerUp(e)}
        onKeyDown={(e) => {
          if (editing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            onSwitch();
          }
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
          data-no-drag
          aria-label={expanded ? t("collapse") : t("expand")}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
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
            <div
              data-no-drag
              className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
            >
              <RowAction
                icon={PencilEdit02Icon}
                label={t("renameSpace")}
                onClick={onStartRename}
              />
              <RowAction
                icon={PlusSignIcon}
                label={t("newTab")}
                onClick={onNewTab}
              />
              {canDelete && (
                <RowAction
                  icon={Delete02Icon}
                  label={t("deleteSpace")}
                  destructive
                  onClick={onDelete}
                />
              )}
            </div>
          </>
        )}
      </div>

      {expanded && (
        <div className="flex flex-col gap-px py-0.5 pl-10 pr-0.5">
          {tabs.map((t) => (
            <TabRow
              key={t.id}
              tab={t}
              dragging={dragging}
              drop={drop}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onJump={() => onJumpTab(t.id)}
              onClose={() => onCloseTab(t.id)}
            />
          ))}
          {tabs.length === 0 && (
            <span className="px-2 py-1 text-[10.5px] text-muted-foreground/50">
              {draggingTabFromOther ? t("dropToMoveHere") : t("noTabs")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function TabRow({
  tab,
  dragging,
  drop,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onJump,
  onClose,
}: {
  tab: Tab;
  dragging: { kind: "space" | "tab"; id: string | number } | null;
  drop: DropTarget | null;
  onPointerDown: (
    e: React.PointerEvent,
    kind: "space" | "tab",
    id: string | number,
  ) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent, onActivate?: () => void) => void;
  onJump: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("spaces");
  const subtitle = subtitleFor(tab);
  const isDragging = dragging?.kind === "tab" && dragging.id === tab.id;
  const reorderEdge =
    drop?.kind === "tab" && drop.tabId === tab.id ? drop.edge : null;

  return (
    <div className="relative">
      {reorderEdge && <DropLine edge={reorderEdge} />}
      {/* biome-ignore lint/a11y/useSemanticElements: drag row hosts a nested close button, cannot be a <button> */}
      <div
        data-drop="tab"
        data-tab-id={tab.id}
        role="button"
        tabIndex={0}
        onPointerDown={(e) => onPointerDown(e, "tab", tab.id)}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerUp(e, onJump)}
        onPointerCancel={(e) => onPointerUp(e)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onJump();
          }
        }}
        className={cn(
          "group/tab relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-primary/40",
          isDragging && "opacity-50",
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
          data-no-drag
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label={t("closeTab")}
          className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/tab:opacity-70 hover:opacity-100"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

function DropLine({ edge }: { edge: Edge }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary",
        edge === "top" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2",
      )}
    />
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
