import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CanvasIcon from "@hugeicons/core-free-icons/CanvasIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import ComputerTerminal02Icon from "@hugeicons/core-free-icons/ComputerTerminal02Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import GitCompareIcon from "@hugeicons/core-free-icons/GitCompareIcon";
import Globe02Icon from "@hugeicons/core-free-icons/Globe02Icon";
import IncognitoIcon from "@hugeicons/core-free-icons/IncognitoIcon";
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
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
  onNewArtifacts: () => void;
  onNewWorkflow: () => void;
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
  onNewArtifacts,
  onNewWorkflow,
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
                <div
                  key={t.id}
                  data-tab-id={t.id}
                  className={cn(
                    "group/tab-cell flex h-7 shrink-0 items-center rounded-md transition-colors",
                    isActive ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  <TabsTrigger
                    value={String(t.id)}
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
                      "h-7 min-w-0 shrink gap-1.5 rounded-md bg-transparent text-xs transition-colors hover:bg-transparent hover:text-foreground/80 justify-start",
                      isActive ? "text-foreground" : "text-muted-foreground",
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
                      {(t.kind === "editor" || t.kind === "workflow") &&
                      t.dirty ? (
                        <span
                          aria-label="Unsaved changes"
                          className="size-1.5 shrink-0 rounded-full bg-foreground/70"
                        />
                      ) : null}
                    </span>
                  </TabsTrigger>
                  {tabs.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Close ${labelFor(t)} tab`}
                      className="mr-0.5 size-7 rounded p-0 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100 group-hover/tab-cell:opacity-60 focus-visible:opacity-100"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(t.id);
                      }}
                    >
                      <HugeiconsIcon
                        data-icon="inline-start"
                        icon={Cancel01Icon}
                        strokeWidth={2}
                      />
                    </Button>
                  )}
                </div>
              );

              if (t.kind !== "terminal") return trigger;

              return (
                <ContextMenu key={t.id}>
                  <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
                  <ContextMenuContent
                    className="min-w-36"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <ContextMenuGroup>
                      <ContextMenuItem onSelect={() => setEditingId(t.id)}>
                        <HugeiconsIcon
                          icon={PencilEdit02Icon}
                          strokeWidth={1.75}
                        />
                        <span className="flex-1">Rename</span>
                      </ContextMenuItem>
                    </ContextMenuGroup>
                    {tabs.length > 1 && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuGroup>
                          <ContextMenuItem onSelect={() => onClose(t.id)}>
                            <HugeiconsIcon
                              icon={Cancel01Icon}
                              strokeWidth={1.75}
                            />
                            <span className="flex-1">Close</span>
                          </ContextMenuItem>
                        </ContextMenuGroup>
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
              <HugeiconsIcon
                data-icon="inline-start"
                icon={PlusSignIcon}
                strokeWidth={2}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => onNew()}>
                <HugeiconsIcon
                  icon={ComputerTerminal02Icon}
                  strokeWidth={1.75}
                />
                <span className="flex-1">Terminal</span>
                <span className="text-xs text-muted-foreground">
                  {fmtShortcut(MOD_KEY, "T")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onNewPrivate()}>
                <HugeiconsIcon icon={IncognitoIcon} strokeWidth={1.75} />
                <span className="flex-1">Privacy</span>
                <span className="text-xs text-muted-foreground">
                  {fmtShortcut(MOD_KEY, "R")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onNewEditor()}>
                <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={1.75} />
                <span className="flex-1">Editor</span>
                <span className="text-xs text-muted-foreground">
                  {fmtShortcut(MOD_KEY, "E")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onNewPreview()}>
                <HugeiconsIcon icon={Globe02Icon} strokeWidth={1.75} />
                <span className="flex-1">Preview</span>
                <span className="text-xs text-muted-foreground">
                  {fmtShortcut(MOD_KEY, "P")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onNewArtifacts()}>
                <HugeiconsIcon icon={File01Icon} strokeWidth={1.75} />
                <span className="flex-1">Artifacts</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onNewWorkflow()}>
                <HugeiconsIcon icon={CanvasIcon} strokeWidth={1.75} />
                <span className="flex-1">Canvas</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onNewGitGraph()}>
                <HugeiconsIcon icon={GitBranchIcon} strokeWidth={1.75} />
                <span className="flex-1">Git Graph</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === "editor" || tab.kind === "markdown") {
    const url = fileIconUrl(tab.title);
    return url ? (
      <img
        src={url}
        alt=""
        width={14}
        height={14}
        className="size-3.5 shrink-0"
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
  if (tab.kind === "pi-workspace") {
    return (
      <HugeiconsIcon
        icon={CodeIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "artifact" || tab.kind === "artifact-hub") {
    return (
      <HugeiconsIcon
        icon={File01Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "workflow") {
    return (
      <HugeiconsIcon
        icon={CanvasIcon}
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
