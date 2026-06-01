import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootPath: string | null;
  onOpenFile: (path: string) => void;
};

type SearchHit = {
  path: string;
  rel: string;
  name: string;
  is_dir: boolean;
};

type SearchResult = {
  hits: SearchHit[];
  truncated: boolean;
};

type ListFilesResult = {
  files: string[];
  truncated: boolean;
};

type FileItem = {
  path: string;
  rel: string;
  name: string;
};

const DEBOUNCE_MS = 150;

function getBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function QuickOpenDialog({
  open,
  onOpenChange,
  rootPath,
  onOpenFile,
}: Props) {
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<FileItem[]>([]);
  const [truncated, setTruncated] = useState(false);

  // Clear query and list initial workspace files when opening
  useEffect(() => {
    if (!open) {
      setQuery("");
      setItems([]);
      setTruncated(false);
      return;
    }

    if (!rootPath) {
      setItems([]);
      setTruncated(false);
      return;
    }

    // Load initial files recursively up to a limit
    let alive = true;
    invoke<ListFilesResult>("fs_list_files", {
      root: rootPath,
      limit: 100,
      showHidden,
      workspace: currentWorkspaceEnv(),
    })
      .then((res) => {
        if (!alive) return;
        const mapped = res.files.map((rel) => {
          const separator = rootPath.endsWith("/") || rootPath.endsWith("\\") ? "" : "/";
          const path = `${rootPath}${separator}${rel}`;
          return {
            path,
            rel,
            name: getBasename(rel),
          };
        });
        setItems(mapped);
        setTruncated(res.truncated);
      })
      .catch((err) => {
        console.error("fs_list_files failed:", err);
      });

    return () => {
      alive = false;
    };
  }, [open, rootPath, showHidden]);

  // Debounced fuzzy search as user types
  useEffect(() => {
    const q = query.trim();
    if (!q) return; // Managed by the open-effect above when empty
    if (!rootPath) return;

    let alive = true;

    const handler = setTimeout(async () => {
      try {
        const res = await invoke<SearchResult>("fs_search", {
          root: rootPath,
          query: q,
          limit: 100,
          showHidden,
          workspace: currentWorkspaceEnv(),
        });
        if (alive) {
          const mapped = res.hits
            .filter((h) => !h.is_dir)
            .map((h) => ({
              path: h.path,
              rel: h.rel,
              name: h.name,
            }));
          setItems(mapped);
          setTruncated(res.truncated);
        }
      } catch (err) {
        if (alive) {
          console.error("fs_search failed:", err);
          setItems([]);
          setTruncated(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      alive = false;
      clearTimeout(handler);
    };
  }, [query, rootPath, showHidden]);

  const handleSelect = (path: string) => {
    onOpenFile(path);
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Quick Open"
      description="Search files in your workspace..."
      className="max-w-lg"
    >
      <CommandInput
        placeholder="Type a file name to search..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-96">
        <CommandEmpty>No matching files found.</CommandEmpty>
        {items.length > 0 && (
          <CommandGroup heading={query.trim() ? "Search Results" : "Files in Workspace"}>
            {items.map((item) => {
              const icon = fileIconUrl(item.name);
              return (
                <CommandItem
                  key={item.path}
                  value={item.rel}
                  onSelect={() => handleSelect(item.path)}
                  className="flex items-center gap-2.5 px-3 py-2 cursor-pointer"
                >
                  {icon ? (
                    <img src={icon} alt="" className="size-3.5 shrink-0" />
                  ) : (
                    <span className="size-3.5 shrink-0 bg-muted rounded-xs" />
                  )}
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-foreground truncate">
                      {item.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate font-mono">
                      {item.rel}
                    </span>
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {truncated && (
          <div className="px-4 py-2 text-[10px] text-center text-muted-foreground italic border-t border-border/30">
            Showing first 100 matches. Refine your query for more results.
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}
