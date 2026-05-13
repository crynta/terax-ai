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
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuGroup,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { HugeiconsIcon } from "@hugeicons/react";
import { Reorder } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { EditorTab, Tab } from "./lib/useTabs";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onClose: (id: number) => void;
  onPin: (id: number) => void;
  onRename: (id: number, newTitle: string) => void;
  onReorder: (tabs: Tab[]) => void;
  compact?: boolean;
};

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onNew,
  onNewPreview,
  onNewEditor,
  onClose,
  onPin,
  onRename,
  onReorder,
  compact,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editingTabId, setEditingTabId] = useState<number | null>(null);

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
    <div className="flex w-max items-center gap-0.5">
      <div
        ref={scrollRef}
        data-tauri-drag-region
        className="min-w-0 shrink overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <Tabs value={String(activeId)} onValueChange={(v) => onSelect(Number(v))}>
          <TabsList className="h-7 w-max gap-0.5 bg-transparent p-0">
            <Reorder.Group
              axis="x"
              values={tabs}
              onReorder={onReorder}
              className="flex w-max items-center gap-0.5"
            >
              {tabs.map((t) => {
                const isPreview = t.kind === "editor" && (t as EditorTab).preview;
                return (
                    <Reorder.Item
                      key={t.id}
                      value={t}
                      id={String(t.id)}
                    >
                      <ContextMenu>
                        <ContextMenuTrigger>
                          <TabsTrigger
                            value={String(t.id)}
                            className={cn(
                              "group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md text-xs transition-colors",
                        "hover:text-foreground/80",
                              t.id === activeId
                                ? "bg-accent text-foreground"
                          : "text-muted-foreground",
                              compact
                                ? "px-1.5!"
                                : tabs.length === 1
                                  ? "px-2!"
                                  : "ps-2! pe-1!",
                            )}
                            data-tab-id={t.id}
                      onDoubleClick={() => isPreview && onPin(t.id)}
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
                              {editingTabId === t.id ? (
                                <input
                                  autoFocus
                                  className="h-5 w-full px-1 text-xs bg-transparent focus:border-none focus-within:outline-none "
                                  defaultValue={t.title}
                                  onBlur={(e) => {
                                    onRename(t.id, e.target.value);
                                    setEditingTabId(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      onRename(t.id, (e.target as HTMLInputElement).value);
                                      setEditingTabId(null);
                                    }
                                    if (e.key === "Escape") {
                                      setEditingTabId(null);
                                    }
                                  }}
                                />
                              ) : (
                                <span className={cn("truncate", isPreview && "italic")}>
                                  {t.title}
                                </span>
                              )}
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
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuGroup>
                            <ContextMenuItem onClick={() => onPin(t.id)}>
                              <span>Pin</span>
                            </ContextMenuItem>
                            {t.kind !== "editor" && (
                              <ContextMenuItem onClick={() => setEditingTabId(t.id)}>
                                <span>Rename</span>
                              </ContextMenuItem>
                            )}
                          </ContextMenuGroup>
                          <ContextMenuSeparator />
                          <ContextMenuGroup>
                            <ContextMenuItem variant="destructive" onClick={() => onClose(t.id)}>
                              <span>Close</span>
                            </ContextMenuItem>
                          </ContextMenuGroup>
                        </ContextMenuContent>
                      </ContextMenu>
                    </Reorder.Item>
                );
              })}
            </Reorder.Group>
          </TabsList>
        </Tabs>
      </div>
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
            <span className="text-xs text-muted-foreground">{fmtShortcut(MOD_KEY, "T")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onNewEditor()}>
            <HugeiconsIcon
              icon={PencilEdit02Icon}
              size={14}
              strokeWidth={1.75}
            />
            <span className="flex-1">Editor</span>
            <span className="text-xs text-muted-foreground">{fmtShortcut(MOD_KEY, "E")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onNewPreview()}>
            <HugeiconsIcon icon={Globe02Icon} size={14} strokeWidth={1.75} />
            <span className="flex-1">Preview</span>
            <span className="text-xs text-muted-foreground">{fmtShortcut(MOD_KEY, "P")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
  return (
    <HugeiconsIcon
      icon={ComputerTerminal02Icon}
      size={14}
      strokeWidth={2}
      className="shrink-0"
    />
  );
}
