import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileAddIcon,
  Folder01Icon,
  FolderAddIcon,
  Refresh01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExplorerSearch, type ExplorerSearchHandle } from "./ExplorerSearch";
import { FileTreeNode } from "./FileTreeNode";
import { InlineInput } from "./InlineInput";
import { copyToClipboard, revealInFinder } from "./lib/contextActions";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";
import { COMPACT_CONTENT, COMPACT_ITEM } from "./lib/menuItemClass";
import { useFileTree } from "./lib/useFileTree";
import { useGlobalShortcuts } from "@/modules/shortcuts";

type Props = {
  rootPath: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
  onRevealInTerminal?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
};

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function FileExplorer({
  rootPath,
  onOpenFile,
  onPathRenamed,
  onPathDeleted,
  onRevealInTerminal,
  onAttachToAgent,
}: Props) {
  const tree = useFileTree(rootPath, { onPathRenamed, onPathDeleted });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<ExplorerSearchHandle>(null);

  type FlatItem = { path: string; isDir: boolean };
  const flat = useMemo<FlatItem[]>(() => {
    if (!rootPath) return [];
    const out: FlatItem[] = [];
    const walk = (parent: string) => {
      const node = tree.nodes[parent];
      if (!node || node.status !== "loaded") return;
      for (const e of node.entries) {
        const p = tree.joinPath(parent, e.name);
        const isDir = e.kind === "dir";
        out.push({ path: p, isDir });
        if (isDir && tree.expanded.has(p)) walk(p);
      }
    };
    walk(rootPath);
    return out;
  }, [rootPath, tree.nodes, tree.expanded, tree.joinPath]);

  useEffect(() => {
    if (selectedPath && !flat.some((f) => f.path === selectedPath)) {
      setSelectedPath(null);
    }
  }, [flat, selectedPath]);

  useGlobalShortcuts({
    "explorer.search": () => {
      if (searchRef.current?.isFocused()) {
        setIsSearchOpen(false);
        return;
      }
      setIsSearchOpen(true);
      searchRef.current?.focus();
    },
  });

  if (!rootPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <HugeiconsIcon
          icon={Folder01Icon}
          size={24}
          strokeWidth={1.5}
          className="text-muted-foreground"
        />
        <div className="text-xs text-muted-foreground">
          No current directory
        </div>
      </div>
    );
  }

  const root = tree.nodes[rootPath];
  const pendingAtRoot =
    tree.pendingCreate?.parentPath === rootPath ? tree.pendingCreate : null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (tree.renaming || tree.pendingCreate || isSearchOpen) return;
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    )
      return;
    if (flat.length === 0) return;

    const currentIdx = selectedPath
      ? flat.findIndex((f) => f.path === selectedPath)
      : -1;

    const move = (next: number) => {
      const clamped = Math.max(0, Math.min(flat.length - 1, next));
      const path = flat[clamped].path;
      setSelectedPath(path);
      requestAnimationFrame(() => {
        const el = listRef.current?.querySelector<HTMLElement>(
          `[data-fs-path="${CSS.escape(path)}"]`
        );
        el?.scrollIntoView({ block: "nearest" });
      });
    };

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(currentIdx < 0 ? 0 : currentIdx + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(currentIdx < 0 ? flat.length - 1 : currentIdx - 1);
        break;
      case "ArrowRight": {
        if (currentIdx < 0) return;
        e.preventDefault();
        const item = flat[currentIdx];
        if (item.isDir) {
          if (!tree.expanded.has(item.path)) tree.toggle(item.path);
          else move(currentIdx + 1);
        }
        break;
      }
      case "ArrowLeft": {
        if (currentIdx < 0) return;
        e.preventDefault();
        const item = flat[currentIdx];
        if (item.isDir && tree.expanded.has(item.path)) {
          tree.toggle(item.path);
        } else {
          const parent = item.path.slice(0, item.path.lastIndexOf("/"));
          if (parent && parent !== rootPath) setSelectedPath(parent);
        }
        break;
      }
      case "Enter":
        if (currentIdx < 0) return;
        e.preventDefault();
        {
          const item = flat[currentIdx];
          if (item.isDir) tree.toggle(item.path);
          else onOpenFile(item.path);
        }
        break;
    }
  };

  return (
    <div
      className="flex h-full flex-col outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <span
          className="flex-1 flex truncate text-xs font-medium text-foreground/80"
          title={rootPath}
        >
          <img
            src={folderIconUrl(basename(rootPath), false)}
            alt=""
            height={15}
            width={15}
            className="mx-1.5"
          />
          {basename(rootPath)}
        </span>

        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={() => setIsSearchOpen((v) => !v)}
          title="Search files"
          aria-label="Search files"
        >
          <HugeiconsIcon icon={Search01Icon} size={13} strokeWidth={2} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={() => tree.beginCreate(rootPath, "file")}
          title="New file"
        >
          <HugeiconsIcon icon={FileAddIcon} size={13} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={() => tree.beginCreate(rootPath, "dir")}
          title="New folder"
        >
          <HugeiconsIcon icon={FolderAddIcon} size={13} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={() => tree.refresh(rootPath)}
          title="Refresh"
        >
          <HugeiconsIcon icon={Refresh01Icon} size={12} strokeWidth={2} />
        </Button>
      </div>

      <ExplorerSearch
        ref={searchRef}
        rootPath={rootPath}
        onOpenFile={onOpenFile}
        open={isSearchOpen}
        onRequestClose={() => setIsSearchOpen(false)}
        onActiveChange={setIsSearchActive}
      />

      {!isSearchActive ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <ScrollArea className="min-h-0 flex-1">
              <div className="py-1" ref={listRef}>
                {pendingAtRoot && (
                  <div
                    className="flex w-full items-center gap-2 px-1.5 py-0.5 text-[13px]"
                    style={{ paddingLeft: 6 }}
                  >
                    <span className="size-3.5 shrink-0" />
                    <img
                      src={
                        pendingAtRoot.kind === "dir"
                          ? folderIconUrl("", false)
                          : fileIconUrl("untitled")
                      }
                      alt=""
                      className="size-4 shrink-0 opacity-70"
                    />
                    <InlineInput
                      initial=""
                      placeholder={
                        pendingAtRoot.kind === "dir" ? "New folder" : "New file"
                      }
                      onCommit={tree.commitCreate}
                      onCancel={tree.cancelCreate}
                    />
                  </div>
                )}
                {root?.status === "loading" && (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground">
                    Loading…
                  </div>
                )}
                {root?.status === "error" && (
                  <div className="px-3 py-2 text-[11px] text-destructive">
                    {root.message}
                  </div>
                )}
                {root?.status === "loaded" &&
                  root.entries.map((entry) => (
                    <FileTreeNode
                      key={entry.name}
                      entry={entry}
                      parentPath={rootPath}
                      rootPath={rootPath}
                      depth={0}
                      tree={tree}
                      onOpenFile={onOpenFile}
                      onRevealInTerminal={onRevealInTerminal}
                      onAttachToAgent={onAttachToAgent}
                      selectedPath={selectedPath}
                      onSelectPath={setSelectedPath}
                    />
                  ))}
              </div>
            </ScrollArea>
          </ContextMenuTrigger>
          <ContextMenuContent className={COMPACT_CONTENT}>
            {onRevealInTerminal && (
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => onRevealInTerminal(rootPath)}
              >
                Open in Terminal
              </ContextMenuItem>
            )}
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() => void revealInFinder(rootPath)}
            >
              Reveal in Finder
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() => tree.beginCreate(rootPath, "file")}
            >
              New File
            </ContextMenuItem>
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() => tree.beginCreate(rootPath, "dir")}
            >
              New Folder
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() => void copyToClipboard(rootPath)}
            >
              Copy Path
            </ContextMenuItem>
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() => tree.refresh(rootPath)}
            >
              Refresh
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : null}
    </div>
  );
}
