import { cn } from "@/lib/utils";
import {
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { TerminalAutocompleteUiModel } from "./lib/autocomplete/types";

export type { TerminalAutocompleteUiModel };

type Props = {
  model: TerminalAutocompleteUiModel | null;
  onPickSuggestion: (index: number) => void;
  /** Terminal pane root (`relative` host); used to keep the list inside the tab. */
  boundsRef: RefObject<HTMLElement | null>;
};

const LIST_MAX_H_PX = 128; // matches max-h-32
const PAD = 4;
const FALLBACK_LIST_W = 160;
/** Tailwind max-w-md */
const LIST_CAP_W = 448;

function scrollSelectedOptionIntoView(
  listEl: HTMLUListElement,
  selectedIndex: number,
) {
  const item = listEl.children[selectedIndex] as HTMLElement | undefined;
  if (!item) return;
  const listRect = listEl.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const pad = 2;
  if (itemRect.bottom > listRect.bottom - pad) {
    listEl.scrollTop += itemRect.bottom - listRect.bottom + pad;
  } else if (itemRect.top < listRect.top + pad) {
    listEl.scrollTop += itemRect.top - listRect.top - pad;
  }
}

export function TerminalAutocompleteOverlay({
  model,
  onPickSuggestion,
  boundsRef,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const [listLayout, setListLayout] = useState<{
    left: number;
    top: number;
    maxHeight: number;
    maxWidth: number;
    minWidth: number;
  } | null>(null);

  const showList = model !== null && model.suggestions.length > 1;
  const showGhost = model !== null && model.ghostSuffix.length > 0;

  const layoutKey =
    model && showList
      ? `${model.anchorLeft}|${model.anchorTop}|${model.cellH}|${model.suggestions.length}|${model.selectedIndex}|${model.suggestions.join("\u0001")}`
      : "";

  useLayoutEffect(() => {
    if (!model || !showList) {
      setListLayout(null);
      return;
    }
    const parent = boundsRef.current;
    if (!parent) {
      setListLayout(null);
      return;
    }

    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    if (pw <= 0 || ph <= 0) {
      setListLayout(null);
      return;
    }

    const list = listRef.current;
    const capW = Math.min(LIST_CAP_W, pw - PAD * 2);
    const listW = Math.max(list?.offsetWidth ?? FALLBACK_LIST_W, FALLBACK_LIST_W);
    const rawListH = list?.offsetHeight ?? LIST_MAX_H_PX;
    const estimatedH = Math.min(rawListH, LIST_MAX_H_PX);

    const anchorLeft = model.anchorLeft;
    const anchorTop = model.anchorTop;
    const cellH = model.cellH;

    let left = anchorLeft;
    left = Math.min(left, pw - Math.min(listW, capW) - PAD);
    left = Math.min(left, pw - capW - PAD);
    left = Math.max(PAD, left);

    const belowTop = anchorTop + cellH + 2;
    const spaceBelow = ph - belowTop - PAD;
    const spaceAbove = anchorTop - PAD;

    let top = belowTop;
    let maxHeight = Math.min(LIST_MAX_H_PX, Math.max(spaceBelow, 48));

    if (spaceBelow < Math.min(estimatedH, 72)) {
      const aboveTop = anchorTop - estimatedH - 2;
      if (spaceAbove >= Math.min(estimatedH, 72) && aboveTop >= PAD) {
        top = aboveTop;
        maxHeight = Math.min(LIST_MAX_H_PX, Math.max(spaceAbove - 2, 48));
      } else {
        maxHeight = Math.max(48, Math.min(LIST_MAX_H_PX, ph - PAD * 2));
        top = Math.max(PAD, ph - maxHeight - PAD);
      }
    }

    const maxWidth = Math.max(80, Math.min(capW, pw - left - PAD));
    const minWidth = Math.min(FALLBACK_LIST_W, maxWidth);

    setListLayout({ left, top, maxHeight, maxWidth, minWidth });
  }, [layoutKey, model, showList, boundsRef]);

  useLayoutEffect(() => {
    if (!model || !showList || !listLayout) return;
    const ul = listRef.current;
    if (!ul) return;
    scrollSelectedOptionIntoView(ul, model.selectedIndex);
  }, [listLayout, model, showList]);

  if (!model || (!showGhost && !showList)) return null;

  const paneW = boundsRef.current?.clientWidth ?? 0;
  const capW =
    paneW > 0 ? Math.min(LIST_CAP_W, paneW - PAD * 2) : LIST_CAP_W;
  const fallbackLeft =
    paneW > 0
      ? Math.max(
          PAD,
          Math.min(model.anchorLeft, paneW - Math.min(FALLBACK_LIST_W, capW) - PAD),
        )
      : model.anchorLeft;
  const fallbackMaxW = Math.max(80, capW);
  const fallbackMinW = Math.min(FALLBACK_LIST_W, fallbackMaxW);

  const listStyle =
    showList && listLayout
      ? {
          left: listLayout.left,
          top: listLayout.top,
          maxHeight: listLayout.maxHeight,
          maxWidth: listLayout.maxWidth,
          minWidth: listLayout.minWidth,
        }
      : showList
        ? {
            left: fallbackLeft,
            top: model.anchorTop + model.cellH + 2,
            maxHeight: LIST_MAX_H_PX,
            maxWidth: fallbackMaxW,
            minWidth: fallbackMinW,
          }
        : null;

  return (
    <>
      {showGhost ? (
        <span
          className={cn(
            "pointer-events-none absolute z-50 whitespace-pre",
            "text-muted-foreground/55",
          )}
          style={{
            left: model.anchorLeft,
            top: model.anchorTop,
            fontFamily: model.fontFamily,
            fontSize: model.fontSize,
            lineHeight: `${model.cellH}px`,
            height: model.cellH,
          }}
          aria-hidden
        >
          {model.ghostSuffix}
        </span>
      ) : null}
      {showList && listStyle ? (
        <ul
          ref={listRef}
          className={cn(
            "absolute z-50 min-w-0 overflow-y-auto rounded-md border border-border/80",
            "bg-popover py-0.5 text-popover-foreground shadow-md",
          )}
          style={{
            left: listStyle.left,
            top: listStyle.top,
            maxHeight: listStyle.maxHeight,
            minWidth: listStyle.minWidth,
            maxWidth: listStyle.maxWidth,
            fontFamily: model.fontFamily,
            fontSize: Math.max(11, model.fontSize - 1),
          }}
          role="listbox"
        >
          {model.suggestions.map((s, i) => (
            <li key={`${i}-${s}`} role="option" aria-selected={i === model.selectedIndex}>
              <button
                type="button"
                className={cn(
                  "flex w-full min-w-0 cursor-pointer px-2 py-0.5 text-left hover:bg-accent/60",
                  i === model.selectedIndex && "bg-accent/50",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPickSuggestion(i);
                }}
              >
                <span className="truncate">{s}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
