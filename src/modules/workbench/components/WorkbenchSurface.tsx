import { cn } from "@/lib/utils";
import {
  currentFocus,
  focusIsMovable,
} from "@/modules/terminal/lib/focusGuard";
import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { activateTab } from "../actions";
import { cards, computeFrames } from "../model/layout";
import { tabById } from "../model/workbench";
import { useActiveTask, useWorkbench } from "../store";
import { requestTerminalRemeasure } from "../terminalGeometry";
import { viewHandle } from "../viewHandles";
import { isMounted, View, viewSpec } from "../views/registry";
import { CardChrome } from "./CardChrome";
import { Divider } from "./Divider";
import { bodyStyle, cardFrame, cardStyle } from "./geometry";
import { slotOf } from "./slot";

/**
 * The active task's cards. Backdrops (border, surface colour) sit under the
 * shared terminal canvas so terminals show through; headers, focus rings and
 * tab content sit above it. Every live tab is rendered once, keyed by id and
 * positioned over its card's body, so moving or splitting never remounts it.
 */
export function WorkbenchSurface() {
  const task = useActiveTask();
  const cardList = task ? cards(task.layout) : [];
  const dividers =
    task && task.maximizedCardId === null
      ? computeFrames(task.layout).dividers
      : [];
  const multiple = cardList.length > 1;
  const shown = cardList.flatMap((c) => {
    if (!task) return [];
    if (task.maximizedCardId !== null && task.maximizedCardId !== c.id)
      return [];
    const frame = cardFrame(task, c.id);
    return frame ? [{ id: c.id, frame }] : [];
  });

  return (
    <div
      data-terminal-stack=""
      className="relative h-full w-full overflow-hidden"
    >
      {shown.map(({ id, frame }) => (
        <div
          key={id}
          aria-hidden
          className="terax-pane absolute"
          style={cardStyle(frame)}
        />
      ))}
      {/*
        The one canvas every WebGPU pane of this window draws into (WebGpuWindowCanvas). It is
        exempt from the app zoom like the panes, so its CSS pixels are real pixels.
      */}
      <div
        data-terminal-area=""
        aria-hidden="true"
        className="zoom-exempt pointer-events-none absolute inset-0 overflow-hidden"
      />
      {task &&
        shown.map(({ id, frame }) => (
          <CardChrome
            key={id}
            taskId={task.id}
            cardId={id}
            x={frame.x}
            y={frame.y}
            w={frame.w}
            h={frame.h}
            focused={task.focusedCardId === id}
            ringed={multiple && task.maximizedCardId === null}
            maximized={task.maximizedCardId === id}
          />
        ))}
      <TabLayer />
      {task &&
        dividers.map((d) => (
          <Divider
            key={`${d.splitId}:${d.index}`}
            taskId={task.id}
            divider={d}
          />
        ))}
    </div>
  );
}

const TabLayer = memo(function TabLayer() {
  const ids = useWorkbench(useShallow((s) => s.tabs.map((t) => t.id)));
  return ids.map((id) => <TabSlot key={id} id={id} />);
});

/** Keyboard focus goes to the view, unless the user is typing elsewhere. */
function focusView(id: number, slot: HTMLElement) {
  const active = currentFocus();
  if (slot.contains(active as Node | null) || !focusIsMovable(active)) return;
  const terminal = viewHandle(id, "terminal");
  if (terminal) return terminal.focus();
  const editor = viewHandle(id, "editor");
  if (editor) return editor.focus();
  slot.focus({ preventScroll: true });
}

const TabSlot = memo(function TabSlot({ id }: { id: number }) {
  const tab = useWorkbench((s) => tabById(s, id));
  const slot = useWorkbench(useShallow((s) => slotOf(s, id)));
  const ref = useRef<HTMLDivElement>(null);
  const focused = !!slot?.focused && !!slot.visible;

  // A card that moved without resizing fires no observer; tell the canvas.
  const lastPosition = useRef(slot);
  useLayoutEffect(() => {
    const previous = lastPosition.current;
    lastPosition.current = slot;
    if (
      tab?.kind === "terminal" &&
      previous &&
      slot &&
      previous.w === slot.w &&
      previous.h === slot.h &&
      (previous.x !== slot.x || previous.y !== slot.y)
    )
      requestTerminalRemeasure();
  }, [slot, tab?.kind]);

  useEffect(() => {
    if (focused && ref.current) focusView(id, ref.current);
  }, [focused, id]);

  if (!tab || !slot || !isMounted(tab, slot.visible)) return null;
  const { inset } = viewSpec(tab.kind);
  const claimFocus = () => {
    if (!slot.focused) activateTab(id);
  };
  return (
    <div
      ref={ref}
      data-tab-slot={id}
      tabIndex={-1}
      aria-hidden={!slot.visible}
      onMouseDownCapture={claimFocus}
      onFocusCapture={claimFocus}
      className={cn(
        "absolute overflow-hidden rounded-b-[calc(var(--pane-radius)-1px)] outline-none",
        inset && "px-2.5 pt-1.5 pb-2",
        !slot.visible && "invisible pointer-events-none",
      )}
      style={bodyStyle(slot)}
    >
      <View tab={tab} visible={slot.visible} focused={slot.focused} />
    </div>
  );
});
