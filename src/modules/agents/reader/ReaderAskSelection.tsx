import { MessageSquareQuoteIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ASK_MIN_CHARS,
  placeAskPill,
  type SelectionSource,
} from "./lib/askSelection";

const PILL = { width: 112, height: 28 };

/**
 * The current selection inside `container`, if it's worth asking about:
 * non-empty, at least two characters, and not inside an input. Code blocks
 * (and tool output) report their language when they have one.
 */
export function readerSelectionSource(
  container: HTMLElement | null,
): { source: SelectionSource; range: Range } | null {
  const selection = window.getSelection();
  if (!container || !selection || selection.isCollapsed) return null;
  if (selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const anchor =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (!anchor || !container.contains(anchor)) return null;
  if (anchor.closest("textarea, input, [contenteditable='true']")) return null;
  const text = selection.toString();
  if (text.trim().length < ASK_MIN_CHARS) return null;
  const block = anchor.closest<HTMLElement>("[data-code-lang]");
  const pre = anchor.closest("pre");
  return {
    range,
    source: {
      text,
      code: Boolean(block || pre),
      lang: block?.dataset.codeLang ?? null,
    },
  };
}

/**
 * A floating "Ask Claude" pill above a selection in the Reader document;
 * clicking it hands the selection to `onAsk` (which quotes it in the composer).
 */
export function AskSelectionPill({
  container,
  onAsk,
}: {
  /** The scrolling document the selection must be inside. */
  container: RefObject<HTMLElement | null>;
  onAsk: (source: SelectionSource) => void;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const pointerDown = useRef(false);
  const onAskRef = useRef(onAsk);
  onAskRef.current = onAsk;
  const host = useRef<HTMLButtonElement | null>(null);

  const update = useCallback(() => {
    const doc = container.current;
    const found = readerSelectionSource(doc);
    if (!found || !doc) {
      setPos(null);
      return;
    }
    const rects = found.range.getClientRects();
    const end = rects.length > 0 ? rects[rects.length - 1] : null;
    const box = end ?? found.range.getBoundingClientRect();
    const view = doc.getBoundingClientRect();
    const placed = placeAskPill(box, view, PILL);
    // Viewport coordinates: the pill is a fixed-position portal on <body>.
    setPos({ left: placed.left + view.left, top: placed.top + view.top });
  }, [container]);

  useEffect(() => {
    const doc = container.current;
    if (!doc) return;
    const onDown = (e: PointerEvent) => {
      if (host.current?.contains(e.target as Node)) return;
      pointerDown.current = true;
      setPos(null);
    };
    const onUp = () => {
      if (!pointerDown.current) return;
      pointerDown.current = false;
      requestAnimationFrame(update);
    };
    // Keyboard selection (Shift+arrows) settles without a pointer.
    const onSelection = () => {
      if (pointerDown.current) return;
      requestAnimationFrame(update);
    };
    const hide = () => setPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPos(null);
        return;
      }
      // Cmd+L quotes a selection in this document; otherwise the Reader's own
      // Cmd+L (focus the composer) handles it.
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "l"
      ) {
        const found = readerSelectionSource(container.current);
        if (!found) return;
        e.preventDefault();
        e.stopPropagation();
        setPos(null);
        window.getSelection()?.removeAllRanges();
        onAskRef.current(found.source);
      }
    };
    doc.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    document.addEventListener("selectionchange", onSelection);
    doc.addEventListener("scroll", hide, { passive: true });
    window.addEventListener("resize", hide);
    document.addEventListener("keydown", onKey, true);
    return () => {
      doc.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("selectionchange", onSelection);
      doc.removeEventListener("scroll", hide);
      window.removeEventListener("resize", hide);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [container, update]);

  const ask = () => {
    const found = readerSelectionSource(container.current);
    setPos(null);
    if (!found) return;
    window.getSelection()?.removeAllRanges();
    onAsk(found.source);
  };

  if (!pos) return null;
  return createPortal(
    <button
      ref={host}
      type="button"
      // Keep the selection while the button is pressed.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={ask}
      title="Quote the selection in your message (⌘L)"
      style={{
        left: pos.left,
        top: pos.top,
        width: PILL.width,
        height: PILL.height,
      }}
      className="terax-ask-pill fixed z-[1100] flex items-center justify-center gap-1.5 rounded-full border border-primary/50 bg-popover text-[12px] font-medium text-foreground shadow-[0_10px_30px_-12px_rgba(0,0,0,0.85)] outline-none transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <HugeiconsIcon icon={MessageSquareQuoteIcon} size={14} strokeWidth={2} />
      Ask Claude
    </button>,
    document.body,
  );
}
