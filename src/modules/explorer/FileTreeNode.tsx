import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useState } from "react";
import { InlineInput } from "./InlineInput";
import {
  copyToClipboard,
  relativePath,
  revealInFinder,
} from "./lib/contextActions";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";
import { COMPACT_CONTENT, COMPACT_ITEM } from "./lib/menuItemClass";
import type { DirEntry, useFileTree } from "./lib/useFileTree";

type Tree = ReturnType<typeof useFileTree>;

type Props = {
  entry: DirEntry;
  parentPath: string;
  rootPath: string;
  depth: number;
  tree: Tree;
  /**
   * Called whenever a file should be opened.
   * `pin` signals persistent intent (e.g. context-menu "Open");
   * omitting it means the caller decides the default (preview).
   */
  onOpenFile: (path: string, pin?: boolean) => void;
  onRevealInTerminal?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
};

function FileTreeNodeImpl({
  entry,
  parentPath,
  rootPath,
  depth,
  tree,
  onOpenFile,
  onRevealInTerminal,
  onAttachToAgent,
  selectedPath,
  onSelectPath,
}: Props) {
  const path = tree.joinPath(parentPath, entry.name);
  const isDir = entry.kind === "dir";
  const isExpanded = isDir && tree.expanded.has(path);
  const children = isExpanded ? tree.nodes[path] : undefined;
  const isRenaming = tree.renaming === path;

  const [isConfirming, setIsConfirming] = useState(false);

  const iconUrl = isDir
    ? folderIconUrl(entry.name, isExpanded)
    : fileIconUrl(entry.name);

  const handleClick = useCallback(() => {
    if (tree.renaming) return;
    onSelectPath(path);
    if (isDir) tree.toggle(path);
    else onOpenFile(path);
  }, [isDir, path, tree, onOpenFile, onSelectPath]);

  const isSelected = selectedPath === path;

  const pendingInThisDir =
    isDir && isExpanded && tree.pendingCreate?.parentPath === path
      ? tree.pendingCreate
      : null;

  // Context menu placement: directory targets itself for new file/folder;
  // a file targets its parent.
  const createTarget = isDir ? path : parentPath;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {isRenaming ? (
            <div
              className="flex w-full items-center gap-2 px-1.5 py-1 text-[13px]"
              style={{ paddingLeft: 6 + depth * 12 }}
            >
              <span className="size-3.5 shrink-0" />
              {iconUrl ? (
                <img src={iconUrl} alt="" className="size-4 shrink-0" />
              ) : (
                <span className="size-4 shrink-0" />
              )}
              <InlineInput
                initial={entry.name}
                onCommit={tree.commitRename}
                onCancel={tree.cancelRename}
              />
            </div>
          ) : (
            <button
              type="button"
              data-fs-path={path}
              onClick={handleClick}
              onDoubleClick={() => !isDir && tree.beginRename(path)}
              className={cn(
                "group flex w-full items-center gap-2 rounded-sm px-1.5 py-0.5 text-left text-[13px] text-foreground/85 transition-colors hover:bg-accent/70 cursor-pointer",
                isSelected && "bg-accent text-foreground",
              )}
              style={{ paddingLeft: 6 + depth * 12 }}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                {isDir ? (
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={12}
                    strokeWidth={2.25}
                    className={cn(
                      "transition-transform",
                      isExpanded && "rotate-90",
                    )}
                  />
                ) : null}
              </span>
              {iconUrl ? (
                <img src={iconUrl} alt="" className="size-4 shrink-0" />
              ) : (
                <span className="size-4 shrink-0" />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent className={COMPACT_CONTENT}>
          {!isDir && (
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() => onOpenFile(path, true)}
            >
              Open
            </ContextMenuItem>
          )}
          {isDir && onRevealInTerminal && (
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() => onRevealInTerminal(path)}
            >
              Open in Terminal
            </ContextMenuItem>
          )}
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => void revealInFinder(path)}
          >
            Reveal in Finder
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => tree.beginCreate(createTarget, "file")}
          >
            New File
          </ContextMenuItem>
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => tree.beginCreate(createTarget, "dir")}
          >
            New Folder
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => void copyToClipboard(path)}
          >
            Copy Path
          </ContextMenuItem>
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => void copyToClipboard(relativePath(rootPath, path))}
          >
            Copy Relative Path
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => onAttachToAgent?.(path)}
          >
            Attach to Agent
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => tree.beginRename(path)}
          >
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            className={COMPACT_ITEM}
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              if (isConfirming) {
                void tree.deletePath(path);
              } else {
                setIsConfirming(true);
              }
            }}
            onMouseLeave={() => setTimeout(() => setIsConfirming(false), 1500)}
          >
            {isConfirming ? "Click again to confirm" : "Delete"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {pendingInThisDir && (
        <div
          className="flex w-full items-center gap-1.5 px-1.5 py-0.5 text-xs"
          style={{ paddingLeft: 6 + (depth + 1) * 12 }}
        >
          <span className="size-3 shrink-0" />
          <span className="size-4 shrink-0" />
          <InlineInput
            initial=""
            placeholder={
              pendingInThisDir.kind === "dir" ? "New folder" : "New file"
            }
            onCommit={tree.commitCreate}
            onCancel={tree.cancelCreate}
          />
        </div>
      )}

      {isDir && isExpanded && children?.status === "loading" && (
        <div
          className="px-2 py-0.5 text-[11px] text-muted-foreground"
          style={{ paddingLeft: 6 + (depth + 1) * 12 + 18 }}
        >
          Loading…
        </div>
      )}
      {isDir && isExpanded && children?.status === "error" && (
        <div
          className="px-2 py-0.5 text-[11px] text-destructive"
          style={{ paddingLeft: 6 + (depth + 1) * 12 + 18 }}
        >
          {children.message}
        </div>
      )}
      {isDir &&
        isExpanded &&
        children?.status === "loaded" &&
        children.entries.map((child) => (
          <FileTreeNode
            key={child.name}
            entry={child}
            parentPath={path}
            rootPath={rootPath}
            depth={depth + 1}
            tree={tree}
            onOpenFile={onOpenFile}
            onRevealInTerminal={onRevealInTerminal}
            onAttachToAgent={onAttachToAgent}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
          />
        ))}
    </>
  );
}

export const FileTreeNode = memo(FileTreeNodeImpl);
