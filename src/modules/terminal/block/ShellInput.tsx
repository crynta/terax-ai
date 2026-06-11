import { detectMonoFontFamily } from "@/lib/fonts";
import { MOD_KEY, fmtShortcut } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useEffect, useRef, useState } from "react";
import {
  getLeafDraft,
  setLeafDraft,
  setLeafInputFocus,
} from "../lib/useTerminalSession";
import {
  historyCommands,
  historyList,
  historyRecord,
  historySuggest,
} from "./lib/history";
import type { BlockMode } from "./lib/modeMachine";
import { createShellEditor, type ShellEditorHandle } from "./lib/shellEditor";

type Props = {
  /** Active leaf the bar is driving; the editor retargets to it. */
  leafId: number;
  mode: BlockMode;
  focused: boolean;
  /** Changes when the active theme changes, so the editor re-themes. */
  themeKey: string;
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  getCwd: () => string | null;
};

export default function ShellInput({
  leafId,
  mode,
  focused,
  themeKey,
  onSubmit,
  onInterrupt,
  getCwd,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ShellEditorHandle | null>(null);
  const commandsRef = useRef<string[]>([]);
  const cbRef = useRef({ onSubmit, onInterrupt, getCwd });
  cbRef.current = { onSubmit, onInterrupt, getCwd };
  const atPrompt = mode === "prompt";
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    let alive = true;
    historyCommands("", 2000).then((cmds) => {
      if (alive) commandsRef.current = cmds;
    });
    return () => {
      alive = false;
    };
  }, []);

  const fontFamilyPref = usePreferencesStore((p) => p.terminalFontFamily);
  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  const fontFamily = fontFamilyPref || detectMonoFontFamily();
  const fontRef = useRef({ fontFamily, fontSize });
  fontRef.current = { fontFamily, fontSize };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = createShellEditor({
      parent: host,
      fontFamily: fontRef.current.fontFamily,
      fontSize: fontRef.current.fontSize,
      commandNames: () => commandsRef.current,
      getCwd: () => cbRef.current.getCwd(),
      onChange: (text) => setEmpty(text.length === 0),
      suggest: historySuggest,
      historyList,
      onSubmit: (text) => {
        historyRecord(text);
        const first = text.trim().split(/\s+/)[0];
        if (first && !commandsRef.current.includes(first)) {
          commandsRef.current = [first, ...commandsRef.current];
        }
        cbRef.current.onSubmit(text);
      },
      onInterrupt: () => cbRef.current.onInterrupt(),
    });
    handleRef.current = handle;
    requestAnimationFrame(() => handleRef.current?.focus());
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, []);

  // Retarget the single editor to the active leaf: register its focus callback
  // and swap drafts so each leaf keeps its own unsent command.
  useEffect(() => {
    setLeafInputFocus(leafId, () => handleRef.current?.focus());
    handleRef.current?.setValue(getLeafDraft(leafId));
    return () => {
      setLeafDraft(leafId, handleRef.current?.getValue() ?? "");
      setLeafInputFocus(leafId, null);
    };
  }, [leafId]);

  useEffect(() => {
    void themeKey;
    handleRef.current?.retheme(fontFamily, fontSize);
  }, [fontFamily, fontSize, themeKey]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.setEditable(atPrompt);
    if (atPrompt) handle.focus();
  }, [atPrompt]);

  useEffect(() => {
    if (focused && atPrompt) handleRef.current?.focus();
  }, [focused, atPrompt]);

  return (
    <div className={cn("flex items-start gap-2", !atPrompt && "opacity-45")}>
      <span
        className="select-none pt-px text-primary/80"
        style={{ fontFamily, fontSize: `${fontSize}px`, lineHeight: 1.5 }}
      >
        ❯
      </span>
      <div ref={hostRef} className="min-w-0 flex-1" />
      {atPrompt && empty && (
        <span className="pointer-events-none shrink-0 select-none self-center pr-0.5 text-[10px] text-muted-foreground/40">
          {fmtShortcut(MOD_KEY, "U")} switch · ↑ history
        </span>
      )}
    </div>
  );
}
