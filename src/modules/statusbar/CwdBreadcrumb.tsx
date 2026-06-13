import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowDown01Icon,
  Folder01Icon,
  Home03Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { COMPACT_CONTENT, COMPACT_ITEM } from "@/modules/explorer/lib/menuItemClass";
import { segmentsFromCwd } from "./lib/pathUtils";

/** Open a folder directly in the system file manager (shows its contents). */
async function openInFileManager(path: string): Promise<void> {
  try {
    await openPath(path);
  } catch (e) {
    console.error("openPath failed:", e);
  }
}

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
};

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i <= 0) return "/";
  return path.slice(0, i);
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i === -1 ? path : path.slice(i + 1);
}

/**
 * Right-click / two-finger tap on a path segment reveals THAT segment in the
 * system file manager. Each segment sets the target during the bubble phase;
 * `onResetTarget` runs first (capture phase) so clicks on separators or empty
 * space fall back to the whole directory.
 */
function RevealMenu({
  revealPath,
  onResetTarget,
  children,
}: {
  revealPath: string | null;
  onResetTarget: () => void;
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="contents"
        onContextMenuCapture={onResetTarget}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className={COMPACT_CONTENT}>
        <ContextMenuItem
          className={COMPACT_ITEM}
          disabled={!revealPath}
          onSelect={() => revealPath && void openInFileManager(revealPath)}
        >
          Reveal in Finder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function CwdBreadcrumb({ cwd, filePath, home, onCd }: Props) {
  // Tracks which path the next "Reveal in Finder" should open; segments set it
  // on right-click, falling back to the whole directory.
  const [revealPath, setRevealPath] = useState<string | null>(null);

  // File mode: dir segments navigate; filename is the terminal leaf.
  if (filePath) {
    const dir = dirname(filePath);
    const name = basename(filePath);
    const segments = segmentsFromCwd(dir, home);
    const first = segments[0];
    const middle = segments.slice(1);
    return (
      <RevealMenu
        revealPath={revealPath}
        onResetTarget={() => setRevealPath(dir)}
      >
        <Breadcrumb>
        <BreadcrumbList className="gap-1 text-xs sm:gap-1.5">
          {first ? (
            <BreadcrumbSegment
              label={first.label}
              isHome={first.isHome}
              onClick={() => onCd(first.fullPath)}
              onReveal={() => setRevealPath(first.fullPath)}
            />
          ) : null}
          {middle.length > 0 ? (
            <CollapsedSegments segments={middle} onCd={onCd} />
          ) : null}
          {middle.map((s) => (
            <span
              key={s.fullPath}
              className="contents max-md:hidden"
            >
              <BreadcrumbSegment
                label={s.label}
                isHome={s.isHome}
                onClick={() => onCd(s.fullPath)}
                onReveal={() => setRevealPath(s.fullPath)}
              />
            </span>
          ))}
          <BreadcrumbItem>
            <BreadcrumbPage
              className="text-foreground"
              onContextMenu={() => setRevealPath(dir)}
            >
              {name}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
        </Breadcrumb>
      </RevealMenu>
    );
  }

  if (!cwd) {
    return (
      <span className="text-xs text-muted-foreground/70">no directory</span>
    );
  }

  const segments = segmentsFromCwd(cwd, home);
  const current = segments[segments.length - 1];
  const parents = segments.slice(0, -1);

  const firstParent = parents[0];
  const middleParents = parents.slice(1);
  return (
    <RevealMenu
      revealPath={revealPath}
      onResetTarget={() => setRevealPath(cwd)}
    >
      <Breadcrumb>
      <BreadcrumbList className="gap-1 text-xs sm:gap-1.5">
        {firstParent ? (
          <BreadcrumbSegment
            label={firstParent.label}
            isHome={firstParent.isHome}
            onClick={() => onCd(firstParent.fullPath)}
            onReveal={() => setRevealPath(firstParent.fullPath)}
          />
        ) : null}
        {middleParents.length > 0 ? (
          <CollapsedSegments segments={middleParents} onCd={onCd} />
        ) : null}
        {middleParents.map((s) => (
          <span key={s.fullPath} className="contents max-md:hidden">
            <BreadcrumbSegment
              label={s.label}
              isHome={s.isHome}
              onClick={() => onCd(s.fullPath)}
              onReveal={() => setRevealPath(s.fullPath)}
            />
          </span>
        ))}
        <BreadcrumbItem>
          <CurrentSegmentDropdown
            label={current.label}
            path={current.fullPath}
            onCd={onCd}
            onReveal={() => setRevealPath(current.fullPath)}
          />
        </BreadcrumbItem>
      </BreadcrumbList>
      </Breadcrumb>
    </RevealMenu>
  );
}

function BreadcrumbSegment({
  label,
  isHome,
  onClick,
  onReveal,
}: {
  label: string;
  isHome: boolean;
  onClick: () => void;
  onReveal: () => void;
}) {
  return (
    <>
      <BreadcrumbItem>
        <BreadcrumbLink asChild>
          <button
            type="button"
            onClick={onClick}
            onContextMenu={onReveal}
            className="cursor-pointer"
          >
            <Badge
              variant="outline"
              className="gap-1 text-muted-foreground hover:text-foreground"
            >
              {isHome ? (
                <HugeiconsIcon
                  icon={Home03Icon}
                  className="size-3"
                  strokeWidth={1.75}
                />
              ) : null}
              {isHome ? "Home" : label}
            </Badge>
          </button>
        </BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="[&>svg]:size-3" />
    </>
  );
}

function CurrentSegmentDropdown({
  label,
  path,
  onCd,
  onReveal,
}: {
  label: string;
  path: string;
  onCd: (p: string) => void;
  onReveal: () => void;
}) {
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const dirs = await invoke<string[]>("list_subdirs", {
        path,
        showHidden,
        workspace: currentWorkspaceEnv(),
      });
      setChildren(dirs);
    } catch (e) {
      setError(String(e));
      setChildren([]);
    }
  }, [path, showHidden]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <BreadcrumbPage
          className="flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-foreground hover:bg-accent"
          onContextMenu={onReveal}
        >
          {label === "~" ? (
            <>
              <HugeiconsIcon
                icon={Home03Icon}
                className="size-3"
                strokeWidth={1.75}
              />
              Home
            </>
          ) : (
            label
          )}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="size-3 opacity-70"
            strokeWidth={2}
          />
        </BreadcrumbPage>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {children === null ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Loading…
          </div>
        ) : children.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {error ?? "No subfolders"}
          </div>
        ) : (
          children.map((name) => (
            <DropdownMenuItem
              key={name}
              onSelect={() =>
                onCd(path.endsWith("/") ? `${path}${name}` : `${path}/${name}`)
              }
            >
              <HugeiconsIcon
                icon={Folder01Icon}
                className="size-3.5 text-muted-foreground"
                strokeWidth={1.75}
              />
              {name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CollapsedSegments({
  segments,
  onCd,
}: {
  segments: { fullPath: string; label: string; isHome: boolean }[];
  onCd: (p: string) => void;
}) {
  return (
    <span className="contents md:hidden">
      <BreadcrumbItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Show hidden folders"
              className="flex items-center rounded-sm px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                className="size-3"
                strokeWidth={1.75}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {segments.map((s) => (
              <DropdownMenuItem
                key={s.fullPath}
                onSelect={() => onCd(s.fullPath)}
              >
                <HugeiconsIcon
                  icon={s.isHome ? Home03Icon : Folder01Icon}
                  className="size-3.5 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <span className="truncate">{s.isHome ? "Home" : s.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="[&>svg]:size-3" />
    </span>
  );
}
