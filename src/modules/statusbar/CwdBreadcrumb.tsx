import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { native } from "@/modules/ai/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { SpaceRootIssue } from "@/modules/spaces/lib/spaceRoot";
import { type WorkspaceEnv, workspaceScopeKey } from "@/modules/workspace";
import {
  Folder01Icon,
  Home03Icon,
  MoreHorizontalIcon,
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
import {
  createLatestRequestGate,
  horizontalWheelDelta,
  joinCanonicalChild,
  listSubdirsForEnv,
  type Segment,
  scrollBreadcrumbToEnd,
  segmentsFromCwd,
} from "./lib/pathUtils";

type Props = {
  root: string | null;
  home: string | null;
  issue?: SpaceRootIssue;
  env: WorkspaceEnv | null;
  onChangeRoot: (path: string) => void;
};

export function SpaceRootBreadcrumb({
  root,
  home,
  issue,
  env,
  onChangeRoot,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!root) return;
    const element = scrollRef.current;
    if (element) scrollBreadcrumbToEnd(element);
  }, [root]);

  if (issue || !root || !env) {
    return (
      <div className="min-w-0 text-xs text-destructive" role="status">
        <span className="block truncate" title={issue?.candidate ?? undefined}>
          Home unavailable{issue?.candidate ? `: ${issue.candidate}` : ""}
        </span>
        {issue?.message ? (
          <span className="block truncate text-[10px]" title={issue.message}>
            {issue.message}
          </span>
        ) : null}
      </div>
    );
  }

  const segments = segmentsFromCwd(root, home);

  return (
    <div
      ref={scrollRef}
      className="min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      onWheel={(event) => {
        const element = event.currentTarget;
        if (element.scrollWidth <= element.clientWidth) return;
        const delta = horizontalWheelDelta(event.deltaX, event.deltaY);
        if (delta === 0) return;
        element.scrollLeft += delta;
        event.preventDefault();
      }}
    >
      <Breadcrumb className="w-max">
        <BreadcrumbList className="flex-nowrap gap-1 text-xs sm:gap-1.5">
          {segments.map((segment, index) => (
            <Fragment key={segment.fullPath}>
              {index > 0 ? (
                <BreadcrumbSeparator className="[&>svg]:size-3" />
              ) : null}
              <BreadcrumbSegment
                segment={segment}
                current={index === segments.length - 1}
                onChangeRoot={onChangeRoot}
              />
            </Fragment>
          ))}
          <BreadcrumbSeparator className="[&>svg]:size-3" />
          <BreadcrumbItem>
            <ChildDirectoryDropdown
              key={`${workspaceScopeKey(env)}\0${root}`}
              path={root}
              env={env}
              onChangeRoot={onChangeRoot}
            />
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}

function BreadcrumbSegment({
  segment,
  current,
  onChangeRoot,
}: {
  segment: Segment;
  current: boolean;
  onChangeRoot: (path: string) => void;
}) {
  const label = segment.isHome ? "Home" : segment.label;

  return (
    <BreadcrumbItem>
      <BreadcrumbLink asChild>
        <button
          type="button"
          aria-current={current ? "page" : undefined}
          title={segment.fullPath}
          onClick={() => onChangeRoot(segment.fullPath)}
          className="cursor-pointer"
        >
          <Badge
            variant="outline"
            className="gap-1 whitespace-nowrap text-muted-foreground hover:text-foreground"
          >
            {segment.isHome ? (
              <HugeiconsIcon
                icon={Home03Icon}
                className="size-3"
                strokeWidth={1.75}
              />
            ) : null}
            {label}
          </Badge>
        </button>
      </BreadcrumbLink>
    </BreadcrumbItem>
  );
}

function ChildDirectoryDropdown({
  path,
  env,
  onChangeRoot,
}: {
  path: string;
  env: WorkspaceEnv;
  onChangeRoot: (path: string) => void;
}) {
  const showHidden = usePreferencesStore((state) => state.showHidden);
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestGate = useRef(createLatestRequestGate()).current;

  const load = useCallback(async () => {
    const id = requestGate.begin();
    setChildren(null);
    setError(null);
    try {
      const next = await listSubdirsForEnv(
        native.listSubdirs,
        path,
        showHidden,
        env,
      );
      if (requestGate.isCurrent(id)) setChildren(next);
    } catch (reason) {
      if (!requestGate.isCurrent(id)) return;
      setError(String(reason));
      setChildren([]);
    }
  }, [env, path, requestGate, showHidden]);

  useEffect(() => {
    if (open) {
      void load();
      return;
    }
    requestGate.invalidate();
  }, [load, open, requestGate]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Choose a subfolder of ${path}`}
          title="Choose a subfolder"
          className="flex items-center rounded-sm px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <HugeiconsIcon
            icon={MoreHorizontalIcon}
            className="size-3.5"
            strokeWidth={1.75}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {children === null ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Loading...
          </div>
        ) : children.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {error ?? "No subfolders"}
          </div>
        ) : (
          children.map((name) => (
            <DropdownMenuItem
              key={name}
              onSelect={() => onChangeRoot(joinCanonicalChild(path, name))}
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
