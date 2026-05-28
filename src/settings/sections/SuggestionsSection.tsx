import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setTerminalCustomSuggestions } from "@/modules/settings/store";
import { clearTerminalHistory } from "@/modules/terminal/lib/AutoSuggestAddon";
import { Delete02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

export function SuggestionsSection() {
  const customSuggestions = usePreferencesStore(
    (s) => s.terminalCustomSuggestions,
  );
  const [newSuggestion, setNewSuggestion] = useState("");

  const handleAdd = async () => {
    const trimmed = newSuggestion.trim();
    if (!trimmed) return;
    if (customSuggestions.includes(trimmed)) return;

    await setTerminalCustomSuggestions([...customSuggestions, trimmed]);
    setNewSuggestion("");
  };

  const handleDelete = async (cmd: string) => {
    await setTerminalCustomSuggestions(
      customSuggestions.filter((c) => c !== cmd),
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Terminal Suggestions"
        description="Manage your custom auto-suggestions and terminal history."
      />

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
          Custom Suggestions
        </span>
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-4">
          <p className="text-[12px] text-muted-foreground">
            Custom suggestions take priority over your terminal history and
            built-in commands.
          </p>
          <div className="flex gap-2">
            <Input
              value={newSuggestion}
              onChange={(e) => setNewSuggestion(e.target.value)}
              placeholder='e.g. echo "Hello World"'
              className="h-8 text-[12px]"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAdd();
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              className="h-8 shrink-0 px-3"
              onClick={() => void handleAdd()}
              disabled={!newSuggestion.trim()}
            >
              <HugeiconsIcon icon={PlusSignIcon} size={14} className="mr-1" />
              Add
            </Button>
          </div>

          <div className="mt-2 flex max-h-[300px] flex-col gap-1 overflow-y-auto pr-1">
            {customSuggestions.length === 0 ? (
              <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-border/60 text-[12px] text-muted-foreground">
                No custom suggestions yet.
              </div>
            ) : (
              customSuggestions.map((cmd) => (
                <div
                  key={cmd}
                  className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3 py-1.5"
                >
                  <span className="truncate font-mono text-[11.5px]">
                    {cmd}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => void handleDelete(cmd)}
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={14} />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
          History
        </span>
        <SettingRow
          title="Clear auto-collected history"
          description="Delete all previously typed commands from the suggestion pool. Doesn't delete custom suggestions."
        >
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="h-7 text-[11px]">
                Clear history
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear terminal history?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to clear the terminal command history? This won't affect your custom suggestions.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void clearTerminalHistory()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Clear History
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SettingRow>
      </div>
    </div>
  );
}
