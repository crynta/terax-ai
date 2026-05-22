// src/modules/sidebar/panels/RecentFilesPanel.tsx
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { useRecentFilesStore } from "../recentFilesStore";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export type RecentFilesPanelProps = {
  onOpenFile: (path: string, pin?: boolean) => void;
};

export function RecentFilesPanel({ onOpenFile }: RecentFilesPanelProps) {
  const paths = useRecentFilesStore((s) => s.paths);
  const clear = useRecentFilesStore((s) => s.clear);

  if (paths.length === 0) {
    return (
      <p className="p-3 text-[11px] text-muted-foreground">
        No recently opened files.
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {paths.map((path) => {
          const parts = path.split(/[\\/]/);
          const filename = parts[parts.length - 1] ?? path;
          const dir = parts.slice(0, -1).join("/");
          const iconUrl = fileIconUrl(path);
          return (
            <button
              key={path}
              type="button"
              onClick={() => onOpenFile(path, true)}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-foreground/[0.04]"
            >
              {iconUrl ? (
                <img src={iconUrl} alt="" className="h-3.5 w-3.5 shrink-0" />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] text-foreground">{filename}</div>
                <div className="truncate text-[10px] text-muted-foreground/60">{dir}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="shrink-0 border-t border-border/60 p-1.5">
        <button
          type="button"
          onClick={clear}
          className="flex w-full items-center justify-center gap-1 rounded-md py-1 text-[11px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
        >
          <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
          Clear
        </button>
      </div>
    </div>
  );
}
