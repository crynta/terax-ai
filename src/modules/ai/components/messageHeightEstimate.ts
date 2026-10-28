// Placeholder height for chat messages that are skipped by
// `content-visibility: auto` before they have ever been laid out. Once a
// message has rendered, `contain-intrinsic-size: auto` remembers its real
// height, so the estimate only matters the first time a long chat is scrolled
// through; a close guess keeps the scrollbar and scroll position from jumping.

type PartLike = { type: string; text?: unknown };

export type EstimableMessage = {
  role: string;
  parts: readonly PartLike[];
};

const LINE_PX = 19;
const CHARS_PER_LINE = 56;
const PART_GAP_PX = 12;
const NON_TEXT_PART_PX = 40;
const USER_BUBBLE_PADDING_PX = 16;
const MIN_PX = 40;
const MAX_PX = 1200;

function textLines(text: string): number {
  let lines = 0;
  let start = 0;
  for (;;) {
    const end = text.indexOf("\n", start);
    const length = (end === -1 ? text.length : end) - start;
    lines += Math.max(1, Math.ceil(length / CHARS_PER_LINE));
    if (end === -1) return lines;
    start = end + 1;
  }
}

export function estimateMessageHeight(message: EstimableMessage): number {
  let height = message.role === "user" ? USER_BUBBLE_PADDING_PX : 0;
  for (const part of message.parts) {
    height +=
      part.type === "text" && typeof part.text === "string"
        ? textLines(part.text) * LINE_PX
        : NON_TEXT_PART_PX;
    height += PART_GAP_PX;
  }
  return Math.min(MAX_PX, Math.max(MIN_PX, Math.round(height)));
}
