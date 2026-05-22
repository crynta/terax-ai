// src/modules/sidebar/panels/RecentFilesPanel.tsx
export type RecentFilesPanelProps = {
  onOpenFile: (path: string, pin?: boolean) => void;
};
export function RecentFilesPanel(_props: RecentFilesPanelProps) {
  return <div className="p-3 text-[11px] text-muted-foreground">Recent Files — coming soon</div>;
}
