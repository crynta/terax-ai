type EditorNavigationHandle = {
  focus(): void;
  gotoLine(line: number, options: { focus: boolean }): void;
};

type ControlFileNavigationDeps = {
  activate: () => Promise<boolean>;
  getEditor: () => EditorNavigationHandle | null;
  setPending: (
    tabId: number,
    navigation: { line?: number; focus: boolean },
  ) => void;
  tabId: number;
  line?: number;
  focus?: boolean;
};

export async function activateControlFileNavigation({
  activate,
  getEditor,
  setPending,
  tabId,
  line,
  focus = true,
}: ControlFileNavigationDeps): Promise<void> {
  if (focus && !(await activate())) return;
  if (!focus && line === undefined) return;
  const editor = getEditor();
  if (!editor) {
    setPending(tabId, line === undefined ? { focus } : { line, focus });
    return;
  }
  if (line === undefined) editor.focus();
  else editor.gotoLine(line, { focus });
}
