// src/modules/sidebar/panels/WorkspaceSearchPanel.tsx
export type WorkspaceSearchPanelProps = {
  explorerRoot: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
};
export function WorkspaceSearchPanel(_props: WorkspaceSearchPanelProps) {
  return <div className="p-3 text-[11px] text-muted-foreground">Search — coming soon</div>;
}
