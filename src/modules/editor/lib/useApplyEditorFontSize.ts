import { usePreferencesStore } from "@/modules/settings/preferences";
import { useEffect } from "react";

const CSS_VAR = "--editor-font-size";

export function useApplyEditorFontSize(): void {
  const fontSize = usePreferencesStore((s) => s.editorFontSize);

  useEffect(() => {
    document.documentElement.style.setProperty(CSS_VAR, `${fontSize}px`);
  }, [fontSize]);
}
