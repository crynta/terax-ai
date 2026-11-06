import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { labelFor } from "@/modules/tabs/lib/tabLabel";
import {
  AgentStatusIcon,
  TabIcon,
  TabRenameInput,
} from "@/modules/tabs/TabBar";
import { ptyIdForLeaf } from "@/modules/terminal";
import {
  Cancel01Icon,
  CancelCircleIcon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type PointerEvent, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { activateTask, renameTask, reorderTask } from "../actions";
import { tabIdsOf } from "../model/layout";
import {
  activeTask,
  focusedTabId,
  projectTasks,
  tabById,
  taskById,
  taskLabel,
} from "../model/workbench";
import { useWorkbench } from "../store";

type Props = {
  onNewTask: () => void;
  /** Closes a task, confirming first when it holds unsaved or running work. */
  onCloseTask: (taskId: number) => void;
  onCloseOtherTasks: (taskId: number) => void;
  compact?: boolean;
};

/** The active project's tasks, main first. */
export function TaskStrip({
  onNewTask,
  onCloseTask,
  onCloseOtherTasks,
  compact,
}: Props) {
  // Ids only: a layout change (every divider-drag frame) must not re-render
  // the strip; items select what they show.
  const ids = useWorkbench(
    useShallow((s) => projectTasks(s, s.activeProjectId).map((t) => t.id)),
  );
  const mainId = useWorkbench(
    (s) =>
      projectTasks(s, s.activeProjectId).find((t) => t.kind === "main")?.id,
  );
  const activeId = useWorkbench((s) => activeTask(s)?.id ?? null);
  const listRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(
    null,
  );
  const [drag, setDrag] = useState<{ id: number; gap: number } | null>(null);
  const pointer = useRef<{
    id: number;
    pointerId: number;
    startX: number;
    active: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      '[data-task-active="true"]',
    );
    const next = el ? { left: el.offsetLeft, width: el.offsetWidth } : null;
    setPill((prev) =>
      prev?.left === next?.left && prev?.width === next?.width ? prev : next,
    );
  });

  useLayoutEffect(() => {
    if (activeId === null) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-task-id="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  const gapAt = (x: number) => {
    const items = [
      ...(listRef.current?.querySelectorAll<HTMLElement>("[data-task-id]") ??
        []),
    ];
    const index = items.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return x < r.left + r.width / 2;
    });
    return index === -1 ? items.length : index;
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>, id: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-no-drag]"))
      return;
    pointer.current = {
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      active: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const st = pointer.current;
    if (!st || st.pointerId !== e.pointerId) return;
    if (!st.active && Math.abs(e.clientX - st.startX) < 4) return;
    st.active = true;
    setDrag({ id: st.id, gap: gapAt(e.clientX) });
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const st = pointer.current;
    pointer.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (st?.active && drag) reorderTask(st.id, drag.gap);
    else if (st) activateTask(st.id);
    setDrag(null);
  };

  return (
    <div className="flex min-w-0 shrink items-center gap-0.5">
      <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div
          ref={listRef}
          role="tablist"
          aria-label="Tasks"
          className="relative flex h-7 w-max items-center gap-0.5"
        >
          {pill && (
            <span
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 h-7 rounded-md bg-foreground/[0.07] shadow-sm ring-1 ring-foreground/[0.05] ring-inset transition-[transform,width] duration-[var(--dur-base)] ease-[var(--ease-premium)]"
              style={{
                width: pill.width,
                transform: `translateX(${pill.left}px)`,
              }}
            />
          )}
          {ids.map((id, i) => (
            <div key={id} className="flex items-center">
              {drag && drag.gap === i && drag.id !== id && <DropMark />}
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    role="tab"
                    tabIndex={0}
                    aria-selected={id === activeId}
                    data-task-id={id}
                    data-task-active={id === activeId ? "true" : undefined}
                    onPointerDown={(e) => onPointerDown(e, id)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onMouseDown={(e) => {
                      if (
                        e.button === 0 &&
                        !(e.target as HTMLElement).closest("[data-no-drag]")
                      )
                        e.preventDefault();
                    }}
                    onPointerCancel={() => {
                      pointer.current = null;
                      setDrag(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        activateTask(id);
                      }
                    }}
                    onDoubleClick={() => setEditingId(id)}
                    onAuxClick={(e) => {
                      if (e.button === 1 && id !== mainId) onCloseTask(id);
                    }}
                    className={cn(
                      "group relative z-[1] flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-md text-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
                      compact ? "px-1.5" : "ps-2 pe-1",
                      id === activeId
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground/80",
                      drag?.id === id && "opacity-50",
                    )}
                  >
                    <TaskIcon taskId={id} />
                    {editingId === id ? (
                      <TaskRename
                        taskId={id}
                        onDone={() => setEditingId(null)}
                      />
                    ) : (
                      <TaskName taskId={id} compact={compact} />
                    )}
                    {id !== mainId && (
                      <button
                        type="button"
                        aria-label="Close task"
                        data-no-drag
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloseTask(id);
                        }}
                        className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent hover:opacity-100 group-hover:opacity-60 focus-visible:opacity-100"
                      >
                        <HugeiconsIcon
                          icon={Cancel01Icon}
                          size={11}
                          strokeWidth={2}
                        />
                      </button>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent
                  className="min-w-36 p-1"
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <MenuItem
                    icon={PencilEdit02Icon}
                    label="Rename"
                    onSelect={() => setEditingId(id)}
                  />
                  <ContextMenuSeparator />
                  <MenuItem
                    icon={Cancel01Icon}
                    label="Close task"
                    disabled={id === mainId}
                    onSelect={() => onCloseTask(id)}
                  />
                  <MenuItem
                    icon={CancelCircleIcon}
                    label="Close other tasks"
                    disabled={ids.length <= 1}
                    onSelect={() => onCloseOtherTasks(id)}
                  />
                </ContextMenuContent>
              </ContextMenu>
              {drag &&
                i === ids.length - 1 &&
                drag.gap === ids.length &&
                drag.id !== id && <DropMark />}
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        aria-label="New task"
        title="New task"
        onClick={onNewTask}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function useTaskLabel(taskId: number): string {
  return useWorkbench((s) => {
    const task = taskById(s, taskId);
    return task ? taskLabel(task, s.tabs, labelFor) : "";
  });
}

function TaskName({ taskId, compact }: { taskId: number; compact?: boolean }) {
  const label = useTaskLabel(taskId);
  return (
    <span className={cn("truncate", compact ? "max-w-40" : "max-w-64")}>
      {label}
    </span>
  );
}

function TaskRename({
  taskId,
  onDone,
}: {
  taskId: number;
  onDone: () => void;
}) {
  const label = useTaskLabel(taskId);
  return (
    <span data-no-drag className="flex">
      <TabRenameInput
        initial={label}
        onCommit={(value) => {
          renameTask(taskId, value);
          onDone();
        }}
        onCancel={onDone}
      />
    </span>
  );
}

/** Agent state across the task's terminals, else its focused tab's icon. */
function TaskIcon({ taskId }: { taskId: number }) {
  const focused = useWorkbench((s) => {
    const task = taskById(s, taskId);
    return task ? tabById(s, focusedTabId(task)) : undefined;
  });
  const terminals = useWorkbench(
    useShallow((s) => {
      const task = taskById(s, taskId);
      return task
        ? tabIdsOf(task.layout).filter(
            (id) => tabById(s, id)?.kind === "terminal",
          )
        : [];
    }),
  );
  if (
    terminals.length > 0 &&
    (terminals.length > 1 || focused?.kind === "terminal")
  )
    return (
      <AgentStatusIcon
        ptyIds={() =>
          terminals.flatMap((id) => {
            const pty = ptyIdForLeaf(id);
            return pty === null ? [] : [pty];
          })
        }
      />
    );
  return focused ? <TabIcon tab={focused} /> : null;
}

function MenuItem({
  icon,
  label,
  onSelect,
  disabled,
}: {
  icon: typeof Cancel01Icon;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <ContextMenuItem
      className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
      disabled={disabled}
      onSelect={onSelect}
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
      <span className="flex-1">{label}</span>
    </ContextMenuItem>
  );
}

function DropMark() {
  return (
    <span
      aria-hidden
      className="mx-px h-5 w-0.5 shrink-0 rounded-full bg-primary"
    />
  );
}
