import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtShortcut, MOD_KEY, SHIFT_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  ALL_LANGUAGES,
  EXPOSED_LANGUAGES,
} from "@/modules/editor/lib/languageDefinitions";
import { resolveDisplayName } from "@/modules/editor/lib/languageResolver";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  Cancel01Icon,
  Clock01Icon,
  ComputerTerminal02Icon,
  GitBranchIcon,
  GitCompareIcon,
  Globe02Icon,
  IncognitoIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { labelFor } from "./lib/tabLabel";
import type { EditorTab, Tab } from "./lib/useTabs";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewBlock: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewGitGraph: () => void;
  onClose: (id: number) => void;
  /** Pin (promote) a preview tab to persistent on double-click. */
  onPin: (id: number) => void;
  /** Set a terminal tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
  /** Move a dragged tab to a new position (insertion gap index 0..tabs.length). */
  onReorder: (fromId: number, toGapIndex: number) => void;
  onOverrideLanguage?: (id: number, lang: string | null) => void;
  compact?: boolean;
};

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onNew,
  onNewBlock,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewGitGraph,
  onClose,
  onPin,
  onRename,
  onReorder,
  onOverrideLanguage,
  compact,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const [showAllLanguages, setShowAllLanguages] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    fromId: number;
    active: boolean;
  } | null>(null);

  // Play the enter animation only for tabs opened after the first paint, never
  // the restored set and never on switch/reorder (triggers are keyed, so they
  // don't remount then). The ref is seeded with the initial ids on first render.
  const seenRef = useRef<Set<number> | null>(null);
  const firstRender = seenRef.current === null;
  let seen = seenRef.current;
  if (seen === null) {
    seen = new Set(tabs.map((t) => t.id));
    seenRef.current = seen;
  }
  useEffect(() => {
    seenRef.current = new Set(tabs.map((t) => t.id));
  }, [tabs]);

  // Single shared pill slides to the active tab instead of each tab toggling
  // its own background. Measured relative to the list (its offsetParent) so it
  // scrolls with the strip for free; transform/width only, no layout on siblings.
  const [pill, setPill] = useState<{ left: number; width: number } | null>(
    null,
  );
  const [pillReady, setPillReady] = useState(false);

  const measurePill = useCallback(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      '[data-tab-active="true"]',
    );
    setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, []);

  useLayoutEffect(() => {
    measurePill();
  }, [measurePill, activeId, tabs]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const ro = new ResizeObserver(measurePill);
    ro.observe(list);
    return () => ro.disconnect();
  }, [measurePill]);

  // Hold the transition off until the pill is first placed, so it never slides
  // in from the origin on mount.
  useEffect(() => {
    if (pill && !pillReady) {
      const id = requestAnimationFrame(() => setPillReady(true));
      return () => cancelAnimationFrame(id);
    }
  }, [pill, pillReady]);

  const gapAtX = (clientX: number) => {
    const els = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [],
    );
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) return i;
    }
    return els.length;
  };

  const endDrag = (currentTarget: HTMLElement) => {
    const st = drag.current;
    if (st) currentTarget.releasePointerCapture?.(st.pointerId);
    drag.current = null;
    setDraggingId(null);
    setDropGap(null);
    document.body.style.userSelect = "";
  };

  // Horizontal wheel scroll without holding shift.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep the active tab visible after selection / open.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  return (
    <div
      ref={scrollRef}
      data-tauri-drag-region
      className="min-w-0 shrink overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-max items-center gap-0.5">
        <Tabs
          value={String(activeId)}
          onValueChange={(v) => onSelect(Number(v))}
        >
          <TabsList
            ref={listRef}
            className="relative h-7 w-max gap-0.5 bg-transparent p-0"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute left-0 top-1/2 h-7 rounded-md bg-foreground/[0.07] shadow-sm ring-1 ring-inset ring-foreground/[0.05]"
              style={
                pill
                  ? {
                      width: pill.width,
                      transform: `translate(${pill.left}px, -50%)`,
                      transitionProperty: pillReady
                        ? "transform, width"
                        : "none",
                      transitionDuration: "var(--dur-base)",
                      transitionTimingFunction: "var(--ease-premium)",
                    }
                  : { opacity: 0 }
              }
            />
            {tabs.map((t, i) => {
              const isPreview = t.kind === "editor" && (t as EditorTab).preview;
              const isActive = t.id === activeId;
              const isNew = !firstRender && !seen.has(t.id);

              const srcIndex = tabs.findIndex((x) => x.id === draggingId);
              const showGap = (gap: number) =>
                draggingId !== null &&
                dropGap === gap &&
                gap !== srcIndex &&
                gap !== srcIndex + 1;

              // While renaming, render a non-button cell so the <input> is not
              // nested inside the trigger <button> (invalid HTML, and WebKit
              // blocks focus/selection on inputs inside buttons).
              if (editingId === t.id && t.kind === "terminal") {
                return (
                  <Fragment key={t.id}>
                    {showGap(i) && <DropIndicator />}
                    <div
                      data-tab-id={t.id}
                      className={cn(
                        "flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent text-xs text-foreground",
                        compact ? "px-1.5" : "px-2",
                      )}
                    >
                      <TabIcon tab={t} />
                      <TabRenameInput
                        initial={labelFor(t)}
                        onCommit={(value) => {
                          onRename(t.id, value);
                          setEditingId(null);
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    </div>
                    {i === tabs.length - 1 && showGap(tabs.length) && (
                      <DropIndicator />
                    )}
                  </Fragment>
                );
              }

              const trigger = (
                <TabsTrigger
                  value={String(t.id)}
                  data-tab-id={t.id}
                  data-tab-active={isActive ? "true" : undefined}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    if ((e.target as HTMLElement).closest("[data-no-drag]"))
                      return;
                    drag.current = {
                      pointerId: e.pointerId,
                      startX: e.clientX,
                      fromId: t.id,
                      active: false,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const st = drag.current;
                    if (!st || st.pointerId !== e.pointerId) return;
                    if (!st.active) {
                      if (Math.abs(e.clientX - st.startX) < 4) return;
                      st.active = true;
                      setDraggingId(st.fromId);
                      document.body.style.userSelect = "none";
                    }
                    e.preventDefault();
                    setDropGap(gapAtX(e.clientX));
                  }}
                  onPointerUp={(e) => {
                    const st = drag.current;
                    if (st?.active && dropGap !== null) {
                      onReorder(st.fromId, dropGap);
                    } else if (st && !st.active) {
                      onSelect(t.id);
                    }
                    endDrag(e.currentTarget);
                  }}
                  onPointerCancel={(e) => endDrag(e.currentTarget)}
                  onDoubleClick={() => isPreview && onPin(t.id)}
                  onAuxClick={(e) => {
                    if (e.button === 1 && tabs.length > 1) {
                      e.preventDefault();
                      e.stopPropagation();
                      onClose(t.id);
                    }
                  }}
                  // Suppress Radix's switch-on-mousedown so a tab grabbed to
                  // drag (or a plain click) only activates on release.
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      return;
                    }
                    if (
                      e.button === 0 &&
                      !(e.target as HTMLElement).closest("[data-no-drag]")
                    ) {
                      e.preventDefault();
                    }
                  }}
                  className={cn(
                    "group relative z-[1] h-7 shrink-0 justify-between gap-1.5 rounded-md bg-transparent text-xs transition-colors data-active:bg-transparent dark:data-active:bg-transparent",
                    isNew && "terax-tab-in",
                    isActive
                      ? "text-foreground dark:text-foreground"
                      : "text-muted-foreground hover:text-foreground/80 dark:text-muted-foreground",
                    draggingId === t.id && "opacity-50",
                    compact
                      ? "px-1.5!"
                      : tabs.length === 1
                        ? "px-2!"
                        : "ps-2! pe-1!",
                  )}
                >
                  <span
                    className={cn(
                      "flex min-w-0 items-center gap-1.5",
                      compact ? "max-w-48" : "max-w-80",
                    )}
                  >
                    {t.kind === "editor" ? (
                      <DropdownMenu
                        onOpenChange={(open) => {
                          if (!open) setShowAllLanguages(false);
                        }}
                      >
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            tabIndex={-1}
                            data-no-drag
                            className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm p-1 -m-1 transition-all hover:bg-accent hover:text-accent-foreground hover:ring-1 hover:ring-primary/30 hover:shadow-[0_0_4px_var(--color-popover-foreground)]"
                          >
                            <TabIcon tab={t} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          side="bottom"
                          sideOffset={6}
                          alignOffset={-4}
                          className="max-h-75 w-48 overflow-y-auto rounded-xl border border-border/40 bg-popover/90 p-1 backdrop-blur-md shadow-lg"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onPointerUp={(e) => e.stopPropagation()}
                        >
                          <DropdownMenuItem
                            onSelect={() => {
                              onOverrideLanguage?.(t.id, null);
                            }}
                            className="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg cursor-default focus:bg-accent focus:text-accent-foreground"
                          >
                            <img
                              src={fileIconUrl(t.title)}
                              className="size-3.5 shrink-0 object-contain"
                              alt=""
                            />
                            <div className="flex flex-1 flex-col">
                              <span>Auto Detect</span>
                              <span className="text-[10px] text-muted-foreground italic">
                                Mode: {resolveDisplayName(t.title)}
                              </span>
                            </div>
                            {!(t as EditorTab).overrideLanguage && (
                              <HugeiconsIcon
                                icon={Tick02Icon}
                                className="size-3.5 text-primary"
                              />
                            )}
                          </DropdownMenuItem>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowAllLanguages((v) => !v);
                            }}
                            className="w-full px-2.5 py-1.5 text-left text-xs text-primary/60 hover:text-primary rounded-lg transition-colors hover:bg-accent"
                          >
                            {showAllLanguages
                              ? "↑ Fewer languages"
                              : "↓ All languages"}
                          </button>
                          <DropdownMenuSeparator className="my-1 border-t border-border/30" />
                          {(showAllLanguages
                            ? ALL_LANGUAGES
                            : EXPOSED_LANGUAGES
                          ).map((lang) => {
                            const isSelected =
                              (t as EditorTab).overrideLanguage === lang.ext;
                            return (
                              <DropdownMenuItem
                                key={lang.ext}
                                onSelect={() =>
                                  onOverrideLanguage?.(t.id, lang.ext)
                                }
                                className="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg cursor-default focus:bg-accent focus:text-accent-foreground"
                              >
                                <img
                                  src={fileIconUrl(`dummy.${lang.ext}`)}
                                  className="size-3.5 shrink-0 object-contain"
                                  alt=""
                                />
                                <span className="flex-1">{lang.name}</span>
                                {isSelected && (
                                  <HugeiconsIcon
                                    icon={Tick02Icon}
                                    className="size-3.5 text-primary"
                                  />
                                )}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <TabIcon tab={t} />
                    )}
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
                    <button
                      type="button"
                      aria-label="Close tab"
                      data-no-drag
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
                    </button>
                  )}
                </TabsTrigger>
              );

              const tabNode =
                t.kind === "terminal" ? (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
                    <ContextMenuContent
                      className="min-w-32 p-1"
                      onCloseAutoFocus={(e) => e.preventDefault()}
                    >
                      <ContextMenuItem
                        className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                        onSelect={() => setEditingId(t.id)}
                      >
                        <HugeiconsIcon
                          icon={PencilEdit02Icon}
                          size={13}
                          strokeWidth={1.75}
                        />
                        <span className="flex-1">Rename</span>
                      </ContextMenuItem>
                      {tabs.length > 1 && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                            onSelect={() => onClose(t.id)}
                          >
                            <HugeiconsIcon
                              icon={Cancel01Icon}
                              size={13}
                              strokeWidth={1.75}
                            />
                            <span className="flex-1">Close</span>
                          </ContextMenuItem>
                        </>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                ) : (
                  trigger
                );

              return (
                <Fragment key={t.id}>
                  {showGap(i) && <DropIndicator />}
                  {tabNode}
                  {i === tabs.length - 1 && showGap(tabs.length) && (
                    <DropIndicator />
                  )}
                </Fragment>
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
          <DropdownMenuContent
            align="start"
            className="min-w-44"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
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
            <DropdownMenuItem onSelect={() => onNewBlock()}>
              <HugeiconsIcon
                icon={ComputerTerminal02Icon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Blocks</span>
              <span className="text-xs text-muted-foreground">
                {fmtShortcut(MOD_KEY, SHIFT_KEY, "T")}
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
              <HugeiconsIcon icon={Globe02Icon} size={14} strokeWidth={1.75} />
              <span className="flex-1">Preview</span>
              <span className="text-xs text-muted-foreground">
                {fmtShortcut(MOD_KEY, "P")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewGitGraph()}>
              <HugeiconsIcon
                icon={GitBranchIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Git Graph</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function DropIndicator() {
  return (
    <span
      aria-hidden
      className="my-0.5 w-0.5 shrink-0 self-stretch rounded-full bg-primary"
    />
  );
}

export function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === "editor" || tab.kind === "markdown") {
    const url =
      tab.kind === "editor" && tab.overrideLanguage
        ? fileIconUrl(`dummy.${tab.overrideLanguage}`)
        : fileIconUrl(tab.title);
    return url ? (
      <img
        src={url}
        alt=""
        className="size-3.5 shrink-0 object-contain"
        onError={(e) => {
          e.currentTarget.src = fileIconUrl("dummy.txt");
        }}
      />
    ) : null;
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
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "terminal" && tab.private) {
    return (
      <HugeiconsIcon
        icon={IncognitoIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") {
    return (
      <HugeiconsIcon
        icon={GitCompareIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "git-history") {
    return (
      <HugeiconsIcon
        icon={Clock01Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
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

function TabRenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Guards against a trailing blur re-resolving an edit that Enter/Escape
  // already finished (Escape must never commit).
  const done = useRef(false);

  useEffect(() => {
    // Focus on the next frame so it runs after the context menu restores focus
    // to its trigger when closing; a synchronous focus would be stolen.
    const raf = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  // explicit = the user pressed Enter, which pins even the unchanged label. A
  // plain blur with no change must not freeze the cwd-derived default into a
  // custom title.
  const commit = (value: string, explicit: boolean) => {
    if (!explicit && value.trim() === initial.trim()) finish(onCancel);
    else finish(() => onCommit(value));
  };

  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label="Rename tab"
      className={cn(
        "w-28 min-w-0 rounded-sm bg-background px-1 text-xs text-foreground",
        "outline-none ring-1 ring-border focus:ring-ring",
      )}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit(e.currentTarget.value, true);
        else if (e.key === "Escape") finish(onCancel);
      }}
      onBlur={(e) => {
        // Switching windows/apps blurs the input; keep the edit open instead
        // of resolving it on the way out.
        if (!document.hasFocus()) return;
        commit(e.currentTarget.value, false);
      }}
    />
  );
}
