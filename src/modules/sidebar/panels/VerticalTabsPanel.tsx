// src/modules/sidebar/panels/VerticalTabsPanel.tsx
export type VerticalTabsPanelProps = {
  tabs: import("@/modules/tabs").Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
};
export function VerticalTabsPanel(_props: VerticalTabsPanelProps) {
  return <div className="p-3 text-[11px] text-muted-foreground">Vertical Tabs — coming soon</div>;
}
