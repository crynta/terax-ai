import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { File02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { currentWorkspaceEnv } from "@/modules/workspace";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootPath: string | null;
  onCreated: (path: string) => void;
};

function joinPath(parent: string, name: string): string {
  if (parent.endsWith("/")) return `${parent}${name}`;
  return `${parent}/${name}`;
}

export function NewEditorDialog({
  open,
  onOpenChange,
  rootPath,
  onCreated,
}: Props) {
  const [name, setName] = useState("untitled.txt");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName("untitled.txt");
    setError(null);
    // Pre-select the basename so the user can quickly retype the filename
    // while keeping the extension handy.
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const dot = el.value.lastIndexOf(".");
      el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
    }, 0);
  }, [open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    if (trimmed.includes("..")) {
      setError("Path must be relative");
      return;
    }
    if (!rootPath) {
      setError("No workspace root");
      return;
    }
    const path = trimmed.startsWith("/")
      ? trimmed
      : joinPath(rootPath, trimmed);
    try {
      await invoke("fs_create_file", { path, workspace: currentWorkspaceEnv() });
      onCreated(path);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex gap-1.75">
            <HugeiconsIcon icon={File02Icon} size={16} strokeWidth={1.75} />
            New file
          </DialogTitle>
          <DialogDescription>
            Filename (relative to workspace root). The extension determines the
            language mode.
          </DialogDescription>
        </DialogHeader>
        <Input
          ref={inputRef}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="example.ts"
        />
        {error ? (
          <div className="text-xs text-destructive">{error}</div>
        ) : (
          <div className="text-xs text-muted-foreground truncate">
            {rootPath ? joinPath(rootPath, name.trim() || "…") : "—"}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
