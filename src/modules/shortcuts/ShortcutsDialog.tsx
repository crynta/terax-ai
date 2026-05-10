import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import {
  getBindingTokens,
  resolveShortcutBindings,
  SHORTCUTS,
  SHORTCUT_GROUPS,
  type Shortcut,
} from "./shortcuts";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ShortcutsDialog({ open, onOpenChange }: Props) {
  const onOpenSettings = () => {
    onOpenChange(false);
    void openSettingsWindow("shortcuts");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="flex-row items-start justify-between pr-10">
          <div className="flex flex-col gap-1.5">
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Quick reference for Terax controls.
            </DialogDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-[11px] font-medium"
            onClick={onOpenSettings}
          >
            <HugeiconsIcon icon={Settings01Icon} size={12} strokeWidth={2} />
            <span>Customize</span>
          </Button>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] min-h-0 pr-2">
          <div className="flex flex-col gap-5">
            {SHORTCUT_GROUPS.map((group) => {
              const items = SHORTCUTS.filter((s) => s.group === group);
              if (items.length === 0) return null;
              return (
                <section key={group} className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {group}
                  </h3>
                  <ul className="flex flex-col divide-y divide-border/60">
                    {items.map((s) => (
                      <ShortcutDialogRow key={s.id} shortcut={s} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutDialogRow({ shortcut }: { shortcut: Shortcut }) {
  const userBindings = usePreferencesStore((s) => s.shortcuts[shortcut.id]);
  const bindings = resolveShortcutBindings(shortcut.id, userBindings);
  const tokens = getBindingTokens(bindings[0]);

  return (
    <li className="flex items-center justify-between py-2">
      <span className="text-sm text-foreground/90">{shortcut.label}</span>
      {tokens.length > 0 ? (
        <KbdGroup>
          {tokens.map((token, i) => {
            if (shortcut.id === "tab.selectByIndex" && i === 2)
              return <Kbd>1…9</Kbd>;
            return <Kbd key={i}>{token}</Kbd>;
          })}
        </KbdGroup>
      ) : (
        <span className="text-xs text-muted-foreground italic">Unassigned</span>
      )}
    </li>
  );
}
