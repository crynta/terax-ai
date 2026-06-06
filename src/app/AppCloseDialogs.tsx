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
import type { Tab } from "@/modules/tabs";

type AppCloseDialogsProps = {
  pendingCloseTab: number | null;
  pendingDeleteTabs: number[] | null;
  pendingTerminalCloseTab: number | null;
  tabs: Tab[];
  onCancelClose: () => void;
  onCancelDeleteClose: () => void;
  onConfirmClose: () => void;
  onConfirmDeleteClose: () => void;
  onDisposeTab: (tabId: number) => void;
  onTerminalCloseTabChange: (tabId: number | null) => void;
};

function tabTitle(tabs: Tab[], id: number | null): string | null {
  if (id === null) return null;
  return tabs.find((tab) => tab.id === id)?.title ?? null;
}

export function AppCloseDialogs({
  pendingCloseTab,
  pendingDeleteTabs,
  pendingTerminalCloseTab,
  tabs,
  onCancelClose,
  onCancelDeleteClose,
  onConfirmClose,
  onConfirmDeleteClose,
  onDisposeTab,
  onTerminalCloseTabChange,
}: AppCloseDialogsProps) {
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
              {tabTitle(tabs, pendingCloseTab)
                ? `"${tabTitle(tabs, pendingCloseTab)}" has unsaved changes. Close anyway?`
                : "This file has unsaved changes. Close anyway?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelClose}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmClose}>
              Close Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingTerminalCloseTab !== null}
        onOpenChange={(open) => !open && onTerminalCloseTabChange(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              A process is running. Closing this tab will terminate it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => onTerminalCloseTabChange(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingTerminalCloseTab !== null) {
                  onDisposeTab(pendingTerminalCloseTab);
                }
                onTerminalCloseTabChange(null);
              }}
            >
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
                    const title = tabTitle(tabs, pendingDeleteTabs[0]);
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
    </>
  );
}
