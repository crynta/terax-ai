import type { CSSProperties } from "react";
import { computeFrames, type Frame } from "../model/layout";
import type { Task } from "../model/workbench";

/** Half the gap between cards; cards keep it on every side. */
export const HALF_GUTTER = 3;
/** Card header height, including the border above it. */
export const HEADER = 29;

const FULL: Frame = { x: 0, y: 0, w: 1, h: 1 };

const framesByLayout = new WeakMap<
  Task["layout"],
  ReadonlyMap<number, Frame>
>();

/** A card's frame in its task, honouring a maximized card. */
export function cardFrame(task: Task, cardId: number): Frame | undefined {
  if (task.maximizedCardId === cardId) return FULL;
  let frames = framesByLayout.get(task.layout);
  if (!frames) {
    frames = computeFrames(task.layout).cards;
    framesByLayout.set(task.layout, frames);
  }
  return frames.get(cardId);
}

const pct = (n: number) => `${Math.round(n * 1e6) / 1e4}%`;

export function cardStyle(f: Frame): CSSProperties {
  return {
    left: `calc(${pct(f.x)} + ${HALF_GUTTER}px)`,
    top: `calc(${pct(f.y)} + ${HALF_GUTTER}px)`,
    width: `calc(${pct(f.w)} - ${HALF_GUTTER * 2}px)`,
    height: `calc(${pct(f.h)} - ${HALF_GUTTER * 2}px)`,
  };
}

/** The card's body: inside its border, below its header. */
export function bodyStyle(f: Frame): CSSProperties {
  const edge = HALF_GUTTER + 1;
  return {
    left: `calc(${pct(f.x)} + ${edge}px)`,
    top: `calc(${pct(f.y)} + ${HALF_GUTTER + HEADER}px)`,
    width: `calc(${pct(f.w)} - ${edge * 2}px)`,
    height: `calc(${pct(f.h)} - ${HALF_GUTTER * 2 + HEADER + 1}px)`,
  };
}
