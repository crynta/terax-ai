import { FolderSearchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { forwardRef } from "react";
import { ExplorerSearch, type ExplorerSearchHandle } from "./ExplorerSearch";

type Props = {
  rootPath: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
  onOpenTextHit: (
    path: string,
    line: number,
    query: string,
    caseSensitive: boolean,
    exactWord: boolean,
  ) => void;
  onRevealPath?: (path: string) => void;
  onRevealInTerminal?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
};

export const ExplorerPanelSearch = forwardRef<ExplorerSearchHandle, Props>(
  function ExplorerPanelSearch(
    { rootPath, onOpenFile, onOpenTextHit, onRevealPath, onRevealInTerminal, onAttachToAgent },
    ref,
  ) {
    if (!rootPath) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <HugeiconsIcon
            icon={FolderSearchIcon}
            size={24}
            strokeWidth={1.5}
            className="text-muted-foreground"
          />
          <div className="text-xs text-muted-foreground">No current directory</div>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-2">
          <span className="px-1.5 text-xs font-medium text-foreground/80">Search</span>
        </div>
        <ExplorerSearch
          ref={ref}
          rootPath={rootPath}
          onOpenFile={onOpenFile}
          onOpenTextHit={onOpenTextHit}
          onRevealPath={onRevealPath}
          open
          onRequestClose={() => {}}
          onRevealInTerminal={onRevealInTerminal}
          onAttachToAgent={onAttachToAgent}
        />
      </div>
    );
  },
);
