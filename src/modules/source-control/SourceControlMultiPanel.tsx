import { type ComponentProps, memo, useEffect, useMemo, useState } from "react";
import { native } from "@/modules/ai/lib/native";
import { SourceControlPanel } from "./SourceControlPanel";
import { useSourceControl } from "./useSourceControl";

type PanelProps = ComponentProps<typeof SourceControlPanel>;
type SharedPanelProps = Omit<PanelProps, "open" | "sourceControl">;

type Props = PanelProps & {
  /** Directory the panel is probing; scanned for sub-repos when it is not itself a repo. */
  scanPath: string | null;
};

/**
 * Wraps the single-repo SourceControlPanel with multi-root support: when the active
 * workspace directory is not itself a git repo but contains child repositories (e.g. a
 * git-worktree workspace), render one collapsible SourceControlPanel per child repo so
 * every sub-repo's changes show on one screen. Falls back to the original single panel
 * when the cwd is inside a repo, or when no child repos are found.
 */
export const SourceControlMultiPanel = memo(function SourceControlMultiPanel({
  scanPath,
  sourceControl,
  open,
  ...shared
}: Props) {
  // null = discovery for the current scanPath hasn't resolved yet.
  const [roots, setRoots] = useState<string[] | null>(null);

  // Re-discover on every scanPath change — NOT gated on the parent summary, whose
  // hasRepo lags behind tab switches and would otherwise keep the panel stuck on a
  // closed tab's single repo.
  useEffect(() => {
    let cancelled = false;
    if (!scanPath) {
      setRoots([]);
      return;
    }
    native
      .gitDiscoverRepos(scanPath)
      .then((r) => {
        if (!cancelled) setRoots(r);
      })
      .catch(() => {
        if (!cancelled) setRoots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [scanPath]);

  // Multiple sibling repos under the directory → one collapsible section each.
  if (roots && roots.length > 1) {
    return (
      <div className="flex h-full min-w-0 flex-col overflow-y-auto bg-card/80 backdrop-blur">
        {roots.map((root) => (
          <RepoSection key={root} repoRoot={root} shared={shared} />
        ))}
      </div>
    );
  }

  // 0 or 1 repo, or discovery still loading → original single-repo panel.
  return (
    <SourceControlPanel open={open} sourceControl={sourceControl} {...shared} />
  );
});

const RepoSection = memo(function RepoSection({
  repoRoot,
  shared,
}: {
  repoRoot: string;
  shared: SharedPanelProps;
}) {
  const [open, setOpen] = useState(true);
  // Keep enabled even when collapsed so the header still shows the changed count.
  const sc = useSourceControl(repoRoot, true);
  const name = useMemo(
    () => repoRoot.replace(/\/+$/, "").split("/").pop() || repoRoot,
    [repoRoot],
  );

  return (
    <div className="flex shrink-0 flex-col border-b border-border/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex shrink-0 items-center gap-2 px-3 py-2 text-left hover:bg-foreground/[0.04]"
      >
        <span className="text-[10px] text-muted-foreground/70">
          {open ? "▾" : "▸"}
        </span>
        <span className="truncate text-[12px] font-semibold text-foreground/90">
          {name}
        </span>
        {sc.status?.branch ? (
          <span className="truncate text-[11px] font-normal text-muted-foreground">
            {sc.status.isDetached ? "detached" : sc.status.branch}
          </span>
        ) : null}
        {sc.changedCount > 0 ? (
          <span className="ml-auto rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {sc.changedCount}
          </span>
        ) : null}
      </button>
      {open ? (
        // ponytail: fixed section height keeps each embedded panel's internal scroll
        // working; make it resizable if users want to grow one repo.
        <div className="h-[22rem] shrink-0 border-t border-border/30">
          <SourceControlPanel
            open
            sourceControl={sc}
            {...shared}
            onOpenGitGraph={undefined}
          />
        </div>
      ) : null}
    </div>
  );
});
