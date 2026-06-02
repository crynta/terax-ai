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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";
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
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { labelFor } from "./lib/tabLabel";
import type { EditorTab, Tab } from "./lib/useTabs";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewGitGraph: () => void;
  onClose: (id: number) => void;
  /** Pin (promote) a preview tab to persistent on double-click. */
  onPin: (id: number) => void;
  /** Set a terminal tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
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
  onNewGitGraph,
  onClose,
  onPin,
  onRename,
  compact,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

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
  }, [activeId, tabs.length]);

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
          <TabsList className="h-7 w-max gap-0.5 bg-transparent p-0">
            {tabs.map((t) => {
              const isPreview = t.kind === "editor" && (t as EditorTab).preview;
              const isActive = t.id === activeId;

              // While renaming, render a non-button cell so the <input> is not
              // nested inside the trigger <button> (invalid HTML, and WebKit
              // blocks focus/selection on inputs inside buttons).
              if (editingId === t.id && t.kind === "terminal") {
                return (
                  <div
                    key={t.id}
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
                );
              }

              const trigger = (
                <TabsTrigger
                  key={t.id}
                  value={String(t.id)}
                  data-tab-id={t.id}
                  onDoubleClick={() => isPreview && onPin(t.id)}
                  onAuxClick={(e) => {
                    if (e.button === 1 && tabs.length > 1) {
                      e.preventDefault();
                      e.stopPropagation();
                      onClose(t.id);
                    }
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 1) e.preventDefault();
                  }}
                  className={cn(
                    "group h-7 shrink-0 gap-1.5 rounded-md text-xs transition-colors hover:text-foreground/80 justify-between",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground",
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

              if (t.kind !== "terminal") return trigger;

              return (
                <ContextMenu key={t.id}>
                  <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
                  <ContextMenuContent
                    className="min-w-36"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <ContextMenuItem onSelect={() => setEditingId(t.id)}>
                      <HugeiconsIcon
                        icon={PencilEdit02Icon}
                        size={14}
                        strokeWidth={1.75}
                      />
                      <span className="flex-1">Rename</span>
                    </ContextMenuItem>
                    {tabs.length > 1 && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => onClose(t.id)}>
                          <HugeiconsIcon
                            icon={Cancel01Icon}
                            size={14}
                            strokeWidth={1.75}
                          />
                          <span className="flex-1">Close</span>
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
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
              <HugeiconsIcon icon={Globe02Icon} size={14} strokeWidth={1.75} />
              <span className="flex-1">Preview</span>
              <span className="text-xs text-muted-foreground">
                {fmtShortcut(MOD_KEY, "P")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewGitGraph()}>
              <HugeiconsIcon icon={GitBranchIcon} size={14} strokeWidth={1.75} />
              <span className="flex-1">Git Graph</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === "editor" || tab.kind === "markdown") {
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
