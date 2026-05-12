import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  type SavedTerminalCommand,
  newSavedTerminalCommandId,
} from "@/modules/terminal/lib/savedCommands";
import { useSavedTerminalCommandsStore } from "@/modules/terminal/store/savedCommandsStore";
import {
  Add01Icon,
  ComputerTerminal01Icon,
  Delete02Icon,
  Edit02Icon,
  PinIcon,
  PinOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

export function CommandsSection() {
  const commands = useSavedTerminalCommandsStore((s) => s.commands);
  const hydrate = useSavedTerminalCommandsStore((s) => s.hydrate);
  const upsert = useSavedTerminalCommandsStore((s) => s.upsert);
  const remove = useSavedTerminalCommandsStore((s) => s.remove);
  const [editing, setEditing] = useState<SavedTerminalCommand | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="Commands"
        description="Reusable terminal commands for quick access from the status bar."
      />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Terminal commands</Label>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={() =>
              setEditing({
                id: newSavedTerminalCommandId(),
                name: "",
                description: "",
                command: "",
              })
            }
          >
            <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
            New command
          </Button>
        </div>

        {commands.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-6 text-center text-[11px] text-muted-foreground">
            No saved commands yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {commands.map((command) => (
              <li
                key={command.id}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
              >
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/40">
                  <HugeiconsIcon
                    icon={ComputerTerminal01Icon}
                    size={14}
                    strokeWidth={1.5}
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[12px] font-medium">
                    {command.name}
                  </span>
                  <code className="truncate rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                    {command.command}
                  </code>
                  {command.description ? (
                    <span className="truncate text-[10.5px] text-muted-foreground">
                      {command.description}
                    </span>
                  ) : null}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn(
                    "size-7",
                    command.pinned
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                  onClick={() =>
                    upsert({ ...command, pinned: !command.pinned })
                  }
                  title={command.pinned ? "Unpin" : "Pin"}
                >
                  <HugeiconsIcon
                    icon={command.pinned ? PinOffIcon : PinIcon}
                    size={12}
                    strokeWidth={1.75}
                  />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => setEditing(command)}
                  title="Edit"
                >
                  <HugeiconsIcon
                    icon={Edit02Icon}
                    size={12}
                    strokeWidth={1.75}
                  />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(command.id)}
                  title="Delete"
                >
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    size={12}
                    strokeWidth={1.75}
                  />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CommandEditorDialog
        command={editing}
        existing={commands}
        onClose={() => setEditing(null)}
        onSave={(command) => {
          upsert(command);
          setEditing(null);
        }}
      />
    </div>
  );
}

function CommandEditorDialog({
  command,
  existing,
  onClose,
  onSave,
}: {
  command: SavedTerminalCommand | null;
  existing: SavedTerminalCommand[];
  onClose: () => void;
  onSave: (command: SavedTerminalCommand) => void;
}) {
  const [draft, setDraft] = useState<SavedTerminalCommand | null>(command);
  useEffect(() => setDraft(command), [command]);
  if (!draft) return null;

  const isNew = !existing.some((c) => c.id === draft.id);
  const canSave =
    draft.name.trim().length > 0 && draft.command.trim().length > 0;

  const save = () => {
    onSave({
      id: draft.id,
      name: draft.name.trim(),
      description: draft.description.trim(),
      command: draft.command.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(),
    });
  };

  return (
    <Dialog open={!!command} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[14px]">
            {isNew ? "New command" : "Edit command"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Name</Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Run app"
              className="h-8 text-[12px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Command</Label>
            <Input
              value={draft.command}
              onChange={(e) => setDraft({ ...draft, command: e.target.value })}
              placeholder="pnpm tauri dev"
              className="h-8 font-mono text-[11.5px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Description</Label>
            <Input
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              placeholder="Optional note"
              className="h-8 text-[12px]"
            />
          </div>
          <button
            type="button"
            onClick={() => setDraft({ ...draft, pinned: !draft.pinned })}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md border px-2 text-left text-[11.5px] transition-colors",
              draft.pinned
                ? "border-foreground/30 bg-accent text-foreground"
                : "border-border/60 bg-card/60 text-muted-foreground hover:bg-accent/40",
            )}
          >
            <HugeiconsIcon
              icon={draft.pinned ? PinOffIcon : PinIcon}
              size={13}
              strokeWidth={1.75}
            />
            {draft.pinned ? "Pinned in quick access" : "Pin in quick access"}
          </button>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSave} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
