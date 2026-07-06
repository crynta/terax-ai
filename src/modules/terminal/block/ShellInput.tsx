import { resolveFontFamily } from "@/lib/fonts";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useEffect, useRef } from "react";
import {
  clearLeafBlockSelection,
  getLeafDraft,
  leafGridSelection,
  setLeafDraft,
  setLeafInputActivity,
  setLeafInputFocus,
  setLeafInputSetter,
} from "../lib/useTerminalSession";
import { type AiShellSuggest, createAiShellSuggest } from "./lib/aiSuggest";
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
  const leafIdRef = useRef(leafId);
  leafIdRef.current = leafId;
  const atPrompt = mode === "prompt";
  const focusableRef = useRef(false);
  focusableRef.current = focused && atPrompt;

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
  const fontFamily = resolveFontFamily(fontFamilyPref);
  const fontRef = useRef({ fontFamily, fontSize });
  fontRef.current = { fontFamily, fontSize };

  const aiRef = useRef<AiShellSuggest | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // History wins (instant, free); the AI model only fills the gaps.
    const ai = createAiShellSuggest({
      getCwd: () => cbRef.current.getCwd(),
      getRecent: () => commandsRef.current.slice(0, 15),
    });
    aiRef.current = ai;
    const handle = createShellEditor({
      parent: host,
      fontFamily: fontRef.current.fontFamily,
      fontSize: fontRef.current.fontSize,
      placeholderText: `Run a command  -  ↑ history  ${fmtShortcut(MOD_KEY, "U")} switch to AI`,
      commandNames: () => commandsRef.current,
      getCwd: () => cbRef.current.getCwd(),
      onChange: (text) =>
        setLeafInputActivity(leafIdRef.current, text.length > 0),
      suggest: async (line) =>
        (await historySuggest(line)) ??
        (await aiRef.current?.suggest(line))?.[0] ??
        null,
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
      onEscape: () => clearLeafBlockSelection(leafIdRef.current),
    });
    handleRef.current = handle;
    requestAnimationFrame(() => handleRef.current?.focus());
    return () => {
      ai.dispose();
      aiRef.current = null;
      handle.destroy();
      handleRef.current = null;
    };
  }, []);

  // Retarget the single editor to the active leaf: register its focus callback
  // and swap drafts so each leaf keeps its own unsent command. New or switched
  // tabs land with the cursor already in the input.
  useEffect(() => {
    setLeafInputFocus(leafId, () => handleRef.current?.focus());
    setLeafInputSetter(leafId, (text) => handleRef.current?.setValue(text));
    handleRef.current?.setValue(getLeafDraft(leafId));
    requestAnimationFrame(() => {
      if (focusableRef.current && leafIdRef.current === leafId) {
        handleRef.current?.focus();
      }
    });
    return () => {
      const value = handleRef.current?.getValue() ?? "";
      setLeafDraft(leafId, value);
      setLeafInputActivity(leafId, value.length > 0);
      setLeafInputFocus(leafId, null);
      setLeafInputSetter(leafId, null);
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

  // The editor holds focus at the prompt, so a Cmd+C over a grid selection lands
  // here, not on the xterm. Copy the grid selection unless the editor has its own.
  const onCopyCapture = (e: React.ClipboardEvent) => {
    const view = handleRef.current?.view;
    if (view && !view.state.selection.main.empty) return;
    const sel = leafGridSelection(leafId);
    if (!sel) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", sel);
  };

  return (
    <div
      className={cn("flex items-start gap-2", !atPrompt && "opacity-45")}
      onCopyCapture={onCopyCapture}
    >
      <span
        className="select-none pt-px text-primary/80"
        style={{ fontFamily, fontSize: `${fontSize}px`, lineHeight: 1.5 }}
      >
        ❯
      </span>
      <div ref={hostRef} className="min-w-0 flex-1" />
    </div>
  );
}
