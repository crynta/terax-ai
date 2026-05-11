import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useState } from "react";

type ConfirmOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling on the confirm button */
  destructive?: boolean;
  icon?: IconSvgElement;
  iconClass?: string;
};

type ConfirmState = ConfirmOptions & { resolve: (ok: boolean) => void };

export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => setState({ ...opts, resolve }));
  }, []);

  const handleAnswer = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  const dialog = (
    <Dialog open={!!state} onOpenChange={(open) => !open && handleAnswer(false)}>
      <DialogContent showCloseButton={false} className="max-w-sm gap-4">
        <DialogHeader className="gap-3">
          {state?.icon && (
            <div
              className={
                state.iconClass ??
                "flex size-10 items-center justify-center rounded-full bg-amber-500/15"
              }
            >
              <HugeiconsIcon
                icon={state.icon}
                size={20}
                strokeWidth={1.75}
                className={state.iconClass ? undefined : "text-amber-500"}
              />
            </div>
          )}
          <DialogTitle>{state?.title}</DialogTitle>
          <DialogDescription>{state?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => handleAnswer(false)}
            className="flex-1"
          >
            {state?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={state?.destructive ? "destructive" : "default"}
            onClick={() => handleAnswer(true)}
            className="flex-1"
          >
            {state?.confirmLabel ?? "OK"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, dialog };
}
