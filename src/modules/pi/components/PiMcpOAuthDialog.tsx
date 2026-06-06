import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { McpOAuthDialogState } from "@/modules/pi/lib/useMcpSurface";

type PiMcpOAuthDialogProps = {
  dialog: McpOAuthDialogState | null;
  onCancel: () => void;
  onCodeOrRedirectUrlChange: (value: string) => void;
  onReopenAuthorization: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function PiMcpOAuthDialog({
  dialog,
  onCancel,
  onCodeOrRedirectUrlChange,
  onReopenAuthorization,
  onSubmit,
}: PiMcpOAuthDialogProps) {
  return (
    <Dialog
      open={dialog !== null}
      onOpenChange={(open) => {
        if (!open && dialog) onCancel();
      }}
    >
      <DialogContent className="gap-4 sm:max-w-lg">
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Complete MCP OAuth</DialogTitle>
            <DialogDescription>
              Finish browser authorization for{" "}
              {dialog?.server.name ?? "this MCP server"}. Terax will capture the
              loopback callback automatically when the provider redirects back.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-fit rounded-md"
              disabled={dialog?.isCompleting}
              onClick={() => void onReopenAuthorization()}
            >
              Reopen authorization page
            </Button>
            <Textarea
              value={dialog?.codeOrRedirectUrl ?? ""}
              placeholder="http://127.0.0.1:38573/mcp/oauth/callback?code=..."
              autoComplete="off"
              spellCheck={false}
              className="min-h-24 font-mono text-[11px]"
              disabled={dialog?.isCompleting}
              aria-label="OAuth redirect URL or code"
              onChange={(event) =>
                onCodeOrRedirectUrlChange(event.target.value)
              }
            />
            {dialog?.isWaitingForCallback ? (
              <div className="rounded-md border border-border/35 bg-background/65 px-2 py-1.5 text-[11px] text-muted-foreground">
                Waiting for browser callback. If the provider does not redirect
                automatically, paste the final redirect URL or code below.
              </div>
            ) : null}
            {dialog?.error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
                {dialog.error}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={dialog?.isCompleting}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !dialog?.codeOrRedirectUrl.trim() || dialog.isCompleting
              }
            >
              {dialog?.isCompleting ? "Completing…" : "Complete OAuth"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
