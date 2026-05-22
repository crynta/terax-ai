// src/modules/sidebar/panels/OutlinePanel.tsx
import type { EditorPaneHandle } from "@/modules/editor";
export type OutlinePanelProps = {
  activeEditorHandle: EditorPaneHandle | null;
};
export function OutlinePanel(_props: OutlinePanelProps) {
  return <div className="p-3 text-[11px] text-muted-foreground">Outline — coming soon</div>;
}
