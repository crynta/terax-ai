import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useTerminalPasswordStore } from "@/modules/terminal/lib/passwordManager";
import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canInsert: boolean;
  onInsert: (secret: string) => boolean | Promise<boolean>;
};

export function InsertPasswordDialog({
  open,
  onOpenChange,
  canInsert,
  onInsert,
}: Props) {
  const hydrate = useTerminalPasswordStore((s) => s.hydrate);
  const entries = useTerminalPasswordStore((s) => s.entries);
  const reveal = useTerminalPasswordStore((s) => s.reveal);
  const [query, setQuery] = useState("");
  const [insertError, setInsertError] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setInsertError(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => {
      const haystack = `${entry.label}\n${entry.username}\n${entry.notes}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, query]);

  const selectEntry = async (id: string) => {
    if (!canInsert) return;
    setInsertError(null);
    try {
      const secret = await reveal(id);
      if (!secret) {
        setInsertError("Could not insert password.");
        return;
      }
      const inserted = await onInsert(secret);
      if (!inserted) {
        setInsertError("Could not insert password into the active terminal.");
        return;
      }
    } catch {
      setInsertError("Could not insert password into the active terminal.");
      return;
    }
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Insert Password"
      description="Select a saved terminal password and insert it into the active terminal."
      className="top-1/2 w-[min(620px,calc(100vw-32px))] -translate-y-1/2"
    >
      <Command shouldFilter={false} loop>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search passwords by label or username"
          autoFocus
        />
        <CommandList className="max-h-[360px]">
          {insertError ? (
            <div className="px-2 py-1 text-[11px] text-destructive">{insertError}</div>
          ) : null}
          {!canInsert ? (
            <CommandGroup heading="Terminal">
              <CommandItem disabled value="no-terminal">
                Open and focus a terminal tab to insert a password.
              </CommandItem>
            </CommandGroup>
          ) : filtered.length === 0 ? (
            <CommandEmpty>No password entries found.</CommandEmpty>
          ) : (
            <CommandGroup heading="Saved passwords">
              {filtered.map((entry) => (
                <CommandItem
                  key={entry.id}
                  value={`${entry.label} ${entry.username} ${entry.notes}`}
                  onSelect={() => void selectEntry(entry.id)}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[12.5px]">{entry.label}</span>
                    {entry.username ? (
                      <span className="truncate text-[10.5px] text-muted-foreground">
                        {entry.username}
                      </span>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
