import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useState } from "react";
import { InlineInput } from "./InlineInput";
import {
  copyToClipboard,
  relativePath,
  revealInFinder,
} from "./lib/contextActions";
import { GitStatusBadge } from "./GitStatusBadge";
import { gitStatusLabel } from "@/modules/source-control/gitStatusPalette";
import type { GitStatusCode } from "./lib/gitStatusUtils";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";
import { COMPACT_CONTENT, COMPACT_ITEM } from "./lib/menuItemClass";
import type { useFileTree } from "./lib/useFileTree";

type Tree = ReturnType<typeof useFileTree>;

export type EntryRowProps = {
  path: string;
  name: string;
  isDir: boolean;
  isExpanded: boolean;
  depth: number;
  rootPath: string;
  tree: Tree;
  isSelected: boolean;
  isRenaming: boolean;
  onOpenFile: (path: string, pin?: boolean) => void;
  onSelectPath: (path: string) => void;
  onRevealInTerminal?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
  onOpenMarkdownPreview?: (path: string) => void;
  gitStatusCode?: GitStatusCode | null;
  gitignored?: boolean;
};

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

function EntryRowImpl(props: EntryRowProps) {
  const {
    path,
    name,
    isDir,
    isExpanded,
    depth,
    rootPath,
    tree,
    isSelected,
    isRenaming,
    onOpenFile,
    onSelectPath,
    onRevealInTerminal,
    onAttachToAgent,
    onOpenMarkdownPreview,
    gitStatusCode,
    gitignored = false,
  } = props;

  const [isConfirming, setIsConfirming] = useState(false);
  const [cursorOffset, setCursorOffset] = useState(0);
  const iconUrl = isDir ? folderIconUrl(name, isExpanded) : fileIconUrl(name);
  const createTarget = isDir
    ? path
    : path.slice(0, path.lastIndexOf("/")) || rootPath;
  const paddingLeft = 6 + depth * 12;

  // VS Code-style hover: full path, plus the git status when present. A dirty
  // folder (its code is a child-rollup) reads "Contains uncommitted changes".
  const statusLabel = gitignored
    ? "Ignored"
    : gitStatusCode
      ? isDir
        ? "Contains uncommitted changes"
        : gitStatusLabel(gitStatusCode)
      : null;
  const hoverTitle = statusLabel ? `${path} • ${statusLabel}` : path;

  const handleClick = () => {
    if (tree.renaming) return;
    onSelectPath(path);
    if (isDir) tree.toggle(path);
    else onOpenFile(path);
  };

  return (
    <ContextMenu>
      {isRenaming ? (
        <ContextMenuTrigger asChild>
          <div
            className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
            style={{ paddingLeft }}
          >
            <span className="size-3.5 shrink-0" />
            {iconUrl ? (
              <img src={iconUrl} alt="" className="size-4 shrink-0" />
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <InlineInput
              initial={name}
              onCommit={tree.commitRename}
              onCancel={tree.cancelRename}
            />
          </div>
        </ContextMenuTrigger>
      ) : (
        <Tooltip delayDuration={500}>
          <TooltipTrigger asChild>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                data-fs-path={path}
                onPointerEnter={(e) => {
                  const left = e.currentTarget.getBoundingClientRect().left;
                  setCursorOffset(Math.max(0, Math.round(e.clientX - left)));
                }}
                onClick={handleClick}
                onDoubleClick={() => !isDir && tree.beginRename(path)}
                className={cn(
                  "group flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-left text-[13px] transition-colors hover:bg-accent/70",
                  gitignored && !isSelected
                    ? "text-muted-foreground/50"
                    : "text-foreground/85",
                  isSelected && "bg-accent text-foreground",
                )}
                style={{ paddingLeft }}
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
                  <img
                    src={iconUrl}
                    alt=""
                    className={cn(
                      "size-4 shrink-0",
                      gitignored && !isSelected && "opacity-45",
                    )}
                  />
                ) : (
                  <span className="size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {gitStatusCode ? (
                  <GitStatusBadge code={gitStatusCode} isDir={isDir} />
                ) : null}
              </button>
            </ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="start"
            sideOffset={4}
            alignOffset={cursorOffset}
            className="max-w-none whitespace-nowrap border border-border bg-card text-foreground"
          >
            {hoverTitle}
          </TooltipContent>
        </Tooltip>
      )}
      <ContextMenuContent
        className={COMPACT_CONTENT}
        onCloseAutoFocus={(e) => {
          if (tree.renaming || tree.pendingCreate) e.preventDefault();
        }}
      >
        {!isDir && (
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => onOpenFile(path, true)}
          >
            Open
          </ContextMenuItem>
        )}
        {!isDir && isMarkdownPath(path) && onOpenMarkdownPreview && (
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => onOpenMarkdownPreview(path)}
          >
            Open Preview
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
  );
}

export const EntryRow = memo(EntryRowImpl);

export type PendingRowProps = {
  depth: number;
  kind: "file" | "dir";
  onCommit: (name: string) => void | Promise<void>;
  onCancel: () => void;
};

export function PendingRow({
  depth,
  kind,
  onCommit,
  onCancel,
}: PendingRowProps) {
  return (
    <div
      className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      <span className="size-3.5 shrink-0" />
      <img
        src={
          kind === "dir" ? folderIconUrl("", false) : fileIconUrl("untitled")
        }
        alt=""
        className="size-4 shrink-0 opacity-70"
      />
      <InlineInput
        initial=""
        placeholder={kind === "dir" ? "New folder" : "New file"}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}

export function StatusRow({
  depth,
  message,
  tone,
}: {
  depth: number;
  message: string;
  tone: "muted" | "error";
}) {
  return (
    <div
      className={cn(
        "h-6 truncate px-2 text-[11px] leading-6",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      style={{ paddingLeft: 6 + depth * 12 + 18 }}
    >
      {message}
    </div>
  );
}
