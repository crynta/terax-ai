import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { SHORTCUTS, SHORTCUT_GROUPS } from "./shortcuts";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ShortcutsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Quick reference for Terax controls.
          </DialogDescription>
        </DialogHeader>

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
                    <li
                      key={s.id}
                      className="flex items-center justify-between py-2"
                    >
                      <span className="text-sm text-foreground/90">
                        {s.label}
                      </span>
                      <KbdGroup>
                        {s.keys.map((k, i) => (
                          <Kbd key={i}>{k}</Kbd>
                        ))}
                      </KbdGroup>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
