import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  host: string;
  fingerprint: string;
  onAccept: () => void;
  onReject: () => void;
};

export function FingerprintDialog({ open, host, fingerprint, onAccept, onReject }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onReject(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unknown host key</DialogTitle>
          <DialogDescription>
            The authenticity of <strong>{host}</strong> cannot be established.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
          {fingerprint}
        </div>
        <p className="text-sm text-muted-foreground">
          Trust this fingerprint and continue? It will be saved for future connections.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onReject}>
            Cancel
          </Button>
          <Button onClick={onAccept}>
            Trust and Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
