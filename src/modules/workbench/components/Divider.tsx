import {
  beginTerminalResizeInteraction,
  endTerminalResizeInteraction,
} from "@/modules/terminal/lib/terminalResizeInteraction";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { setRatios } from "../actions";
import {
  type Divider as DividerFrame,
  findSplit,
  shiftBoundary,
} from "../model/layout";
import { taskById } from "../model/workbench";
import { snapshot } from "../store";
import { HALF_GUTTER } from "./geometry";
import { createResizeGesture } from "./resizeGesture";

const KEY_STEP = 0.02;

type Props = { taskId: number; divider: DividerFrame };

/**
 * The grip between two children of a split. A drag, or held arrow keys, runs
 * as one terminal resize gesture (shells resize once, on release) and writes
 * ratios at most once a frame.
 */
export function Divider({ taskId, divider }: Props) {
  const row = divider.dir === "row";
  const { splitId, index } = divider;
  const [gesture] = useState(() => {
    const token = {};
    return createResizeGesture({
      begin: () => beginTerminalResizeInteraction(token),
      end: () => endTerminalResizeInteraction(token),
      apply: (ratios) => setRatios(taskId, splitId, ratios),
      schedule: (flush) => requestAnimationFrame(flush),
      cancel: (handle) => cancelAnimationFrame(handle),
    });
  });
  const drag = useRef<{
    pointerId: number;
    origin: number;
    extent: number;
    ratios: readonly number[];
  } | null>(null);

  useEffect(() => () => gesture.finish(), [gesture]);

  const currentRatios = () => {
    const task = taskById(snapshot(), taskId);
    return task ? findSplit(task.layout, splitId)?.ratios : undefined;
  };

  const finish = () => {
    drag.current = null;
    gesture.finish();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const ratios = currentRatios();
    const root = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!ratios || !root) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.start();
    drag.current = {
      pointerId: event.pointerId,
      origin: row ? event.clientX : event.clientY,
      extent: row
        ? root.width * divider.split.w
        : root.height * divider.split.h,
      ratios,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const st = drag.current;
    if (!st || st.pointerId !== event.pointerId || st.extent <= 0) return;
    const delta =
      ((row ? event.clientX : event.clientY) - st.origin) / st.extent;
    gesture.update(shiftBoundary(st.ratios, index, delta));
  };

  const back = row ? "ArrowLeft" : "ArrowUp";
  const forward = row ? "ArrowRight" : "ArrowDown";

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== back && event.key !== forward) return;
    const ratios = currentRatios();
    if (!ratios) return;
    event.preventDefault();
    gesture.start();
    gesture.update(
      shiftBoundary(ratios, index, event.key === back ? -KEY_STEP : KEY_STEP),
    );
  };

  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === back || event.key === forward) finish();
  };

  const { split, at } = divider;
  const style = row
    ? {
        left: `calc(${at * 100}% - ${HALF_GUTTER}px)`,
        top: `calc(${split.y * 100}% + ${HALF_GUTTER}px)`,
        width: HALF_GUTTER * 2,
        height: `calc(${split.h * 100}% - ${HALF_GUTTER * 2}px)`,
      }
    : {
        top: `calc(${at * 100}% - ${HALF_GUTTER}px)`,
        left: `calc(${split.x * 100}% + ${HALF_GUTTER}px)`,
        height: HALF_GUTTER * 2,
        width: `calc(${split.w * 100}% - ${HALF_GUTTER * 2}px)`,
      };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator needs a div.
    <div
      data-workbench-divider=""
      role="separator"
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(
        ((at - (row ? split.x : split.y)) / (row ? split.w : split.h)) * 100,
      )}
      tabIndex={0}
      className={`group absolute z-10 flex touch-none items-center justify-center outline-none ${
        row ? "cursor-col-resize" : "cursor-row-resize"
      }`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={finish}
    >
      <span
        className={`rounded-full bg-primary/0 transition-colors duration-[var(--dur-fast)] group-hover:bg-primary/45 group-focus-visible:bg-primary/60 group-active:bg-primary/60 ${
          row ? "h-full w-0.5" : "h-0.5 w-full"
        }`}
      />
    </div>
  );
}
