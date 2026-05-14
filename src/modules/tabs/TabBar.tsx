import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  Cancel01Icon,
  ComputerTerminal02Icon,
  GitCompareIcon,
  Globe02Icon,
  IncognitoIcon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { EditorTab, Tab } from "./lib/useTabs";

const TAB_SCROLL_THUMB_WIDTH = 44;

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onClose: (id: number) => void;
  /** Pin (promote) a preview tab to persistent on double-click. */
  onPin: (id: number) => void;
  compact?: boolean;
};

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onNew,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onClose,
  onPin,
  compact,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startScrollLeft: number } | null>(
    null,
  );
  const [scrollThumb, setScrollThumb] = useState({
    left: 0,
    visible: false,
    width: TAB_SCROLL_THUMB_WIDTH,
  });

  const updateScrollThumb = useCallback(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track || el.scrollWidth <= el.clientWidth) {
      setScrollThumb((current) =>
        current.visible ? { ...current, left: 0, visible: false } : current,
      );
      return;
    }

    const thumbWidth = Math.min(TAB_SCROLL_THUMB_WIDTH, track.clientWidth);
    const maxThumbLeft = Math.max(1, track.clientWidth - thumbWidth);
    const maxScrollLeft = Math.max(1, el.scrollWidth - el.clientWidth);
    const left = (el.scrollLeft / maxScrollLeft) * maxThumbLeft;
    setScrollThumb({ left, visible: true, width: thumbWidth });
  }, []);

  // Horizontal wheel scroll without holding shift.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;

    updateScrollThumb();
    const observer = new ResizeObserver(updateScrollThumb);
    observer.observe(el);
    observer.observe(track);
    el.addEventListener("scroll", updateScrollThumb);

    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", updateScrollThumb);
    };
  }, [tabs.length, updateScrollThumb]);

  // Keep the active tab visible after selection / open.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    active?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeId, tabs.length]);

  const onScrollbarPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startScrollLeft: el.scrollLeft,
    };
  };

  const onScrollbarPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    const track = trackRef.current;
    const drag = dragRef.current;
    if (!el || !track || !drag) return;

    const maxThumbLeft = Math.max(1, track.clientWidth - scrollThumb.width);
    const maxScrollLeft = Math.max(1, el.scrollWidth - el.clientWidth);
    const dragRatio = (e.clientX - drag.startX) / maxThumbLeft;
    el.scrollLeft = drag.startScrollLeft + dragRatio * maxScrollLeft;
  };

  const onScrollbarPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div className="relative min-w-0 shrink">
      <div
        ref={scrollRef}
        className="terax-tab-scroll min-w-0 overflow-x-auto overflow-y-hidden"
      >
        <div className="flex w-max items-center gap-0.5">
          <Tabs
            value={String(activeId)}
            onValueChange={(v) => onSelect(Number(v))}
          >
            <TabsList className="h-7 w-max gap-0.5 bg-transparent p-0">
              {tabs.map((t) => {
                const isPreview =
                  t.kind === "editor" && (t as EditorTab).preview;
                return (
                  <TabsTrigger
                    key={t.id}
                    value={String(t.id)}
                    data-tab-id={t.id}
                    onDoubleClick={() => isPreview && onPin(t.id)}
                    className={cn(
                      "group h-7 shrink-0 gap-1.5 rounded-md text-xs text-muted-foreground transition-colors data-[state=active]:bg-accent data-[state=active]:text-foreground hover:text-foreground/80 justify-between",
                      compact
                        ? "px-1.5!"
                        : tabs.length === 1
                          ? "px-2!"
                          : "ps-2! pe-1!",
                    )}
                  >
                    <span
                      className={cn(
                        "flex items-center gap-1.5 truncate",
                        compact ? "max-w-48" : "max-w-80",
                      )}
                    >
                      <TabIcon tab={t} />
                      {/* Preview tabs use italic to signal the transient state,
                          matching the visual convention from VSCode. */}
                      <span className={cn("truncate", isPreview && "italic")}>
                        {labelFor(t)}
                      </span>
                      {t.kind === "editor" && t.dirty ? (
                        <span
                          aria-label="Unsaved changes"
                          className="size-1.5 shrink-0 rounded-full bg-foreground/70"
                        />
                      ) : null}
                    </span>
                    {tabs.length > 1 && (
                      <span
                        role="button"
                        aria-label="Close tab"
                        onClick={(e) => {
                          e.stopPropagation();
                          onClose(t.id);
                        }}
                        className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent hover:opacity-100 group-hover:opacity-60"
                      >
                        <HugeiconsIcon
                          icon={Cancel01Icon}
                          size={11}
                          strokeWidth={2}
                        />
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                title="New tab"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuItem onSelect={() => onNew()}>
                <HugeiconsIcon
                  icon={ComputerTerminal02Icon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Terminal</span>
                <span className="text-xs text-muted-foreground">
                  {fmtShortcut(MOD_KEY, "T")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onNewPrivate()}>
                <HugeiconsIcon
                  icon={IncognitoIcon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Privacy</span>
                <span className="text-xs text-muted-foreground">
                  {fmtShortcut(MOD_KEY, "R")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onNewEditor()}>
                <HugeiconsIcon
                  icon={PencilEdit02Icon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Editor</span>
                <span className="text-xs text-muted-foreground">
                  {fmtShortcut(MOD_KEY, "E")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onNewPreview()}>
                <HugeiconsIcon
                  icon={Globe02Icon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Preview</span>
                <span className="text-xs text-muted-foreground">
                  {fmtShortcut(MOD_KEY, "P")}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div
        ref={trackRef}
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-1 opacity-0 transition-opacity",
          scrollThumb.visible && "opacity-100",
        )}
      >
        <div
          className="pointer-events-auto flex h-2 cursor-ew-resize items-end pb-0.5"
          style={{
            width: scrollThumb.width,
            transform: `translateX(${scrollThumb.left}px)`,
          }}
          onPointerDown={onScrollbarPointerDown}
          onPointerMove={onScrollbarPointerMove}
          onPointerUp={onScrollbarPointerUp}
          onPointerCancel={onScrollbarPointerUp}
        >
          <div className="h-0.5 w-full rounded-full bg-muted-foreground/45 transition-colors hover:bg-muted-foreground/65 active:bg-muted-foreground/75" />
        </div>
      </div>
    </div>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === "editor") {
    const url = fileIconUrl(tab.title);
    return url ? <img src={url} alt="" className="size-3.5 shrink-0" /> : null;
  }
  if (tab.kind === "preview") {
    return (
      <HugeiconsIcon
        icon={Globe02Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "ai-diff") {
    return (
      <HugeiconsIcon
        icon={GitCompareIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0 text-yellow-600 dark:text-yellow-400"
      />
    );
  }
  if (tab.kind === "terminal" && tab.private) {
    return (
      <HugeiconsIcon
        icon={IncognitoIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0 text-amber-600 dark:text-amber-400"
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={ComputerTerminal02Icon}
      size={14}
      strokeWidth={2}
      className="shrink-0"
    />
  );
}

function labelFor(t: Tab): string {
  if (t.kind === "editor") return t.title;
  if (t.kind === "preview") return t.title;
  if (t.kind === "ai-diff") return t.title;
  if (!t.cwd) return t.title;
  const parts = t.cwd.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}
