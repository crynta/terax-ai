import type { ComponentProps } from "react";
import { CommandPalette } from "@/modules/command-palette";
import { NewEditorDialog } from "@/modules/editor";
import { ShortcutsDialog } from "@/modules/shortcuts";
import { UpdaterDialog } from "@/modules/updater";
import { AppCloseDialogs } from "./AppCloseDialogs";

type AppOverlaysProps = {
  commandPalette: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    actions: ComponentProps<typeof CommandPalette>["actions"];
    workspaceRoot: ComponentProps<typeof CommandPalette>["workspaceRoot"];
    onOpenFile: ComponentProps<typeof CommandPalette>["onOpenFile"];
  };
  shortcuts: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  };
  newEditor: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    rootPath: ComponentProps<typeof NewEditorDialog>["rootPath"];
    onCreated: ComponentProps<typeof NewEditorDialog>["onCreated"];
  };
  closeDialogs: ComponentProps<typeof AppCloseDialogs>;
};

/**
 * The app's modal/overlay cluster: command palette, shortcuts help, the
 * new-file dialog, the updater prompt, and the tab close/delete confirmations.
 * Grouped so App's render tree carries one overlay node instead of five.
 */
export function AppOverlays({
  commandPalette,
  shortcuts,
  newEditor,
  closeDialogs,
}: AppOverlaysProps) {
  return (
    <>
      <CommandPalette
        open={commandPalette.open}
        onOpenChange={commandPalette.onOpenChange}
        actions={commandPalette.actions}
        workspaceRoot={commandPalette.workspaceRoot}
        onOpenFile={commandPalette.onOpenFile}
      />

      <ShortcutsDialog
        open={shortcuts.open}
        onOpenChange={shortcuts.onOpenChange}
      />

      <NewEditorDialog
        open={newEditor.open}
        onOpenChange={newEditor.onOpenChange}
        rootPath={newEditor.rootPath}
        onCreated={newEditor.onCreated}
      />

      <UpdaterDialog />

      <AppCloseDialogs {...closeDialogs} />
    </>
  );
}
