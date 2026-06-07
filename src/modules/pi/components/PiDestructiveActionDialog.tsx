import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type PendingPiDestructiveAction =
  | { kind: "stop-runtime" }
  | { kind: "mcp-config"; serverId: string };

type PiDestructiveActionDialogProps = {
  action: PendingPiDestructiveAction | null;
  mcpConfigName?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function PiDestructiveActionDialog({
  action,
  mcpConfigName = null,
  onCancel,
  onConfirm,
}: PiDestructiveActionDialogProps) {
  const copy = destructiveActionCopy(action, mcpConfigName);

  return (
    <AlertDialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {copy.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function destructiveActionCopy(
  action: PendingPiDestructiveAction | null,
  mcpConfigName: string | null,
) {
  if (!action) {
    return {
      title: "Confirm action",
      description: "",
      action: "Continue",
    };
  }
  if (action.kind === "stop-runtime") {
    return {
      title: "Stop Pi runtime?",
      description:
        "Active Pi responses will be interrupted and restored sessions will be marked stopped.",
      action: "Stop runtime",
    };
  }
  return {
    title: "Remove MCP server config?",
    description: `This removes ${
      mcpConfigName ?? "this saved MCP server config"
    }. Connected servers keep running until disconnected.`,
    action: "Remove config",
  };
}
