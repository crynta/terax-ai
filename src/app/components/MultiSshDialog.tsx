import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CloudServerIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

type Props = {
  open: boolean;
  hosts: string[];
  onOpenChange: (open: boolean) => void;
  /** Open one tab with a pane per host; broadcast mirrors input to all. */
  onConnect: (hosts: string[], broadcast: boolean) => void;
};

import { MAX_PANES_PER_TAB } from "@/modules/tabs";

const MAX_HOSTS = MAX_PANES_PER_TAB; // one pane per host — hard split cap

export function MultiSshDialog({
  open,
  hosts,
  onOpenChange,
  onConnect,
}: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [broadcast, setBroadcast] = useState(true);

  const toggle = (h: string) =>
    setPicked((p) =>
      p.includes(h)
        ? p.filter((x) => x !== h)
        : p.length >= MAX_HOSTS
          ? p
          : [...p, h],
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPicked([]);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-sm gap-4">
        <DialogHeader>
          <DialogTitle className="text-sm">Multi-SSH</DialogTitle>
          <DialogDescription className="text-xs">
            One tab, a pane per host (up to {MAX_HOSTS}).
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {hosts.map((h) => {
            const on = picked.includes(h);
            return (
              <button
                key={h}
                type="button"
                onClick={() => toggle(h)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  on
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                <HugeiconsIcon
                  icon={CloudServerIcon}
                  size={13}
                  strokeWidth={1.75}
                  className="shrink-0"
                />
                <span className="min-w-0 flex-1 truncate font-mono">{h}</span>
                {on && (
                  <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2} />
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
            Broadcast input to all panes
            <Switch checked={broadcast} onCheckedChange={setBroadcast} />
          </label>
          <Button
            size="sm"
            disabled={picked.length === 0}
            onClick={() => {
              onConnect(picked, broadcast);
              setPicked([]);
              onOpenChange(false);
            }}
          >
            Connect{picked.length > 0 ? ` (${picked.length})` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
