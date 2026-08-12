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
import type { AppCloseBlocker } from "@/app/hooks/useAppCloseGuard";
import type { Tab } from "@/modules/tabs";

type CloseManyPending = {
  kind: "right" | "other";
  closeIds: number[];
  dirtyCount: number;
  busy: boolean;
};

type Props = {
  tabs: Tab[];
  pendingCloseTab: number | null;
  onCancelClose: () => void;
  onConfirmClose: () => void;
  pendingTerminalCloseTab: number | null;
  onCancelTerminalClose: () => void;
  onConfirmTerminalClose: () => void;
  pendingDeleteTabs: number[] | null;
  onCancelDeleteClose: () => void;
  onConfirmDeleteClose: () => void;
  pendingCloseMany: CloseManyPending | null;
  onCancelCloseMany: () => void;
  onConfirmCloseMany: () => void;
  pendingAppClose: AppCloseBlocker | null;
  onCancelAppClose: () => void;
  onConfirmAppClose: () => void;
};

function appCloseMessage(blocker: AppCloseBlocker): string {
  const dirty =
    blocker.dirtyEditors === 1
      ? "1 file has unsaved changes"
      : `${blocker.dirtyEditors} files have unsaved changes`;
  if (blocker.dirtyEditors > 0 && blocker.busyTerminal) {
    return `A process is still running and ${dirty}. Quitting will terminate it and discard the changes.`;
  }
  if (blocker.dirtyEditors > 0) {
    return `${dirty.charAt(0).toUpperCase()}${dirty.slice(1)}. Quitting will discard them.`;
  }
  return "A process is still running in a terminal. Quitting will terminate it.";
}

function closeManyMessage(pending: CloseManyPending, tabs: Tab[]): string {
  const { kind, dirtyCount, busy, closeIds } = pending;
  if (dirtyCount === 1 && !busy) {
    const dirty = tabs.find(
      (t) => t.kind === "editor" && t.dirty && closeIds.includes(t.id),
    );
    return dirty?.title
      ? `"${dirty.title}" has unsaved changes. Close it anyway?`
      : "1 tab has unsaved changes. Close it anyway?";
  }
  if (dirtyCount > 0 && busy) {
    return `${dirtyCount} tab${dirtyCount === 1 ? "" : "s"} have unsaved changes and a process is running. Closing will discard the changes and terminate the process. Close anyway?`;
  }
  if (dirtyCount > 0) {
    return `${dirtyCount} tabs have unsaved changes. Closing will discard them. Close anyway?`;
  }
  return kind === "right"
    ? "A process is running in a tab to the right. Closing it will terminate the process. Close anyway?"
    : "A process is running in another tab. Closing it will terminate the process. Close anyway?";
}

/** Confirmation dialogs for closing dirty editors and terminals with live processes. */
export function CloseDialogs({
  tabs,
  pendingCloseTab,
  onCancelClose,
  onConfirmClose,
  pendingTerminalCloseTab,
  onCancelTerminalClose,
  onConfirmTerminalClose,
  pendingDeleteTabs,
  onCancelDeleteClose,
  onConfirmDeleteClose,
  pendingCloseMany,
  onCancelCloseMany,
  onConfirmCloseMany,
  pendingAppClose,
  onCancelAppClose,
  onConfirmAppClose,
}: Props) {
  return (
    <>
      <AlertDialog
        open={pendingCloseTab !== null}
        onOpenChange={(open) => !open && onCancelClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              {tabs.find((t) => t.id === pendingCloseTab)?.title
                ? `"${
                    tabs.find((t) => t.id === pendingCloseTab)?.title
                  }" has unsaved changes. Close anyway?`
                : "This file has unsaved changes. Close anyway?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelClose}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmClose}>
              Close Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingTerminalCloseTab !== null}
        onOpenChange={(open) => !open && onCancelTerminalClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              A process is running. Closing this tab will terminate it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelTerminalClose}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmTerminalClose}>
              Close Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDeleteTabs !== null}
        onOpenChange={(open) => !open && onCancelDeleteClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteTabs?.length === 1
                ? (() => {
                    const title = tabs.find(
                      (t) => t.id === pendingDeleteTabs[0],
                    )?.title;
                    return title
                      ? `"${title}" has unsaved changes. The file has been deleted. Close anyway?`
                      : "This file has unsaved changes. The file has been deleted. Close anyway?";
                  })()
                : `${pendingDeleteTabs?.length ?? 0} files have unsaved changes. They have been deleted. Close all anyway?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelDeleteClose}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDeleteClose}>
              Close Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingCloseMany !== null}
        onOpenChange={(open) => !open && onCancelCloseMany()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingCloseMany?.kind === "right"
                ? "Close Tabs to the Right"
                : "Close Other Tabs"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCloseMany ? closeManyMessage(pendingCloseMany, tabs) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelCloseMany}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmCloseMany}>
              Close Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingAppClose !== null}
        onOpenChange={(open) => !open && onCancelAppClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quit Terax?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAppClose ? appCloseMessage(pendingAppClose) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelAppClose}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmAppClose}>
              Quit Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
