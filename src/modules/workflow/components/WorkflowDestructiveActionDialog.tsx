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

export type PendingWorkflowDestructiveAction =
  | { kind: "artifact"; artifactId: string; label: string }
  | { kind: "clear" }
  | { kind: "node"; nodeId: string; title: string };

type WorkflowDestructiveActionDialogProps = {
  action: PendingWorkflowDestructiveAction | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function WorkflowDestructiveActionDialog({
  action,
  onCancel,
  onConfirm,
}: WorkflowDestructiveActionDialogProps) {
  const copy = workflowDestructiveActionCopy(action);
  if (!copy) return null;

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
            {copy.actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function workflowDestructiveActionCopy(
  action: PendingWorkflowDestructiveAction | null,
) {
  if (!action) return null;
  if (action.kind === "node") {
    return {
      actionLabel: "Delete Node",
      description: `Delete "${action.title}" and its connected edges?`,
      title: "Delete workflow node?",
    };
  }
  if (action.kind === "artifact") {
    return {
      actionLabel: "Delete Artifact",
      description: `Delete artifact "${action.label}" from this workflow?`,
      title: "Delete artifact?",
    };
  }
  return {
    actionLabel: "Clear Canvas",
    description: "Clear all workflow nodes, edges, and artifacts?",
    title: "Clear workflow canvas?",
  };
}
