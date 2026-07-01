import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { resolveFontFamily } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  SHORTCUTS,
  type KeyBinding,
  type ShortcutId,
} from "@/modules/shortcuts";
import {
  activeAgentForLeaf,
  subscribeTerminalAgentActivity,
} from "@/modules/terminal/lib/useTerminalSession";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  codeMirrorKeyForBinding,
  createComposerEditor,
  type ComposerEditorHandle,
} from "./composerEditor";
import { clampComposerHeight, DEFAULT_COMPOSER_HEIGHT } from "./composerLayout";
import {
  COMPOSER_SYNTAX_MODES,
  type ComposerSyntaxMode,
  loadComposerSyntaxExtension,
  resolveComposerSyntaxMode,
  resolveComposerSyntaxModeForContext,
} from "./composerLanguage";
import { useTerminalComposerStore } from "./terminalComposerStore";

type Props = {
  leafId: number;
  onSend: (text: string) => void;
  onClose: () => void;
};

const SHORTCUTS_BY_ID = new Map(
  SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]),
);

export function TerminalComposer({ leafId, onSend, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ComposerEditorHandle | null>(null);
  const stopResizeRef = useRef<(() => void) | null>(null);
  const [composerHeight, setComposerHeight] = useState(DEFAULT_COMPOSER_HEIGHT);
  const [syntaxOverride, setSyntaxOverride] =
    useState<ComposerSyntaxMode | null>(null);
  const [activeAgent, setActiveAgent] = useState(() =>
    activeAgentForLeaf(leafId),
  );
  const setDraft = useTerminalComposerStore((state) => state.setDraft);
  const fontFamilyPref = usePreferencesStore(
    (state) => state.terminalFontFamily,
  );
  const fontSize = usePreferencesStore((state) => state.terminalFontSize);
  const userShortcuts = usePreferencesStore((state) => state.shortcuts);
  const defaultSyntaxMode = usePreferencesStore(
    (state) => state.terminalComposerSyntaxMode,
  );
  const syntaxRules = usePreferencesStore(
    (state) => state.terminalComposerSyntaxRules,
  );
  const fontFamily = resolveFontFamily(fontFamilyPref);
  const sendKeys = useMemo(
    () => shortcutKeysFor("terminalComposer.send", userShortcuts),
    [userShortcuts],
  );
  const queueKeys = useMemo(
    () => shortcutKeysFor("terminalComposer.queue", userShortcuts),
    [userShortcuts],
  );
  const contextSyntaxMode = useMemo(
    () =>
      resolveComposerSyntaxModeForContext({
        agentName: activeAgent,
        defaultMode: defaultSyntaxMode,
        rules: syntaxRules,
      }),
    [activeAgent, defaultSyntaxMode, syntaxRules],
  );
  const syntaxMode = syntaxOverride ?? contextSyntaxMode;

  useEffect(() => {
    setSyntaxOverride(null);
    const update = () => setActiveAgent(activeAgentForLeaf(leafId));
    update();
    return subscribeTerminalAgentActivity(update);
  }, [leafId]);

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const handle = createComposerEditor({
      parent,
      doc: useTerminalComposerStore.getState().draftFor(leafId),
      fontFamily,
      fontSize,
      sendKeys,
      queueKeys,
      shellCompletion: syntaxMode === "bash",
      syntaxExtension: [],
      onChange: (text) => setDraft(leafId, text),
      onSend: (text) => sendDraft(leafId, text, onSend),
      onQueue: (text) => queueDraft(leafId, text),
      onClose,
    });
    handleRef.current = handle;
    requestAnimationFrame(() => handle.focus());
    return () => {
      const value = handle.getValue();
      setDraft(leafId, value);
      handle.destroy();
      handleRef.current = null;
    };
  }, [
    leafId,
    fontFamily,
    fontSize,
    onClose,
    onSend,
    queueKeys,
    sendKeys,
    setDraft,
    syntaxMode,
  ]);

  useEffect(() => {
    let cancelled = false;
    void loadComposerSyntaxExtension(syntaxMode).then((extension) => {
      if (!cancelled) handleRef.current?.setSyntaxExtension(extension);
    });
    return () => {
      cancelled = true;
    };
  }, [syntaxMode]);

  useEffect(() => {
    return () => stopResizeRef.current?.();
  }, []);

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      stopResizeRef.current?.();

      const startY = event.clientY;
      const startHeight = composerHeight;
      const previousCursor = document.body.style.cursor;

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        document.body.style.cursor = previousCursor;
        stopResizeRef.current = null;
      };
      const onMove = (moveEvent: PointerEvent) => {
        setComposerHeight(
          clampComposerHeight(startHeight + startY - moveEvent.clientY),
        );
      };

      document.body.style.cursor = "ns-resize";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cleanup, { once: true });
      window.addEventListener("pointercancel", cleanup, { once: true });
      stopResizeRef.current = cleanup;
    },
    [composerHeight],
  );

  const sendCurrent = () => {
    const text = handleRef.current?.getValue() ?? "";
    if (!sendDraft(leafId, text, onSend)) return;
    handleRef.current?.clear();
  };

  const queueCurrent = () => {
    const text = handleRef.current?.getValue() ?? "";
    if (!queueDraft(leafId, text)) return;
    handleRef.current?.clear();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild className="select-text">
        <div className="shrink-0 border-t border-border/60 bg-card/75 px-3 py-2">
          <button
            type="button"
            aria-label="Resize terminal composer"
            title="Drag to resize composer"
            onPointerDown={beginResize}
            className="-mx-3 -mt-2 mb-1 flex h-2 w-[calc(100%+1.5rem)] cursor-ns-resize items-center justify-center"
          >
            <span className="h-px w-12 rounded-full bg-border/70 transition-colors hover:bg-foreground/40" />
          </button>
          <div className="flex items-start gap-2 rounded-md border border-border/50 bg-background/70 px-2.5 py-2 shadow-sm">
            <div
              ref={hostRef}
              className={cn("min-w-0 flex-1 overflow-hidden text-sm")}
              style={{ height: composerHeight }}
            />
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Queue"
                onClick={queueCurrent}
              >
                <HugeiconsIcon icon={TerminalIcon} size={14} strokeWidth={2} />
              </Button>
              <Button
                type="button"
                variant="default"
                size="icon"
                className="h-7 w-7"
                title="Send"
                onClick={sendCurrent}
              >
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={14}
                  strokeWidth={2}
                />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Close"
                onClick={onClose}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
              </Button>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <ContextMenuLabel className="text-[11px] text-muted-foreground">
          Syntax mode
        </ContextMenuLabel>
        <ContextMenuRadioGroup
          value={syntaxMode}
          onValueChange={(value) =>
            setSyntaxOverride(resolveComposerSyntaxMode(value))
          }
        >
          {COMPOSER_SYNTAX_MODES.map((mode) => (
            <ContextMenuRadioItem
              key={mode.id}
              value={mode.id}
              className="text-[12px]"
            >
              {mode.label}
            </ContextMenuRadioItem>
          ))}
        </ContextMenuRadioGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function sendDraft(
  leafId: number,
  text: string,
  onSend: (text: string) => void,
): boolean {
  const store = useTerminalComposerStore.getState();
  store.setDraft(leafId, text);
  const draft = store.consumeDraft(leafId);
  if (!draft) return false;
  onSend(draft);
  return true;
}

function queueDraft(leafId: number, text: string): boolean {
  const store = useTerminalComposerStore.getState();
  store.setDraft(leafId, text);
  return store.enqueueDraft(leafId) !== null;
}

function shortcutKeysFor(
  id: ShortcutId,
  userShortcuts: Record<ShortcutId, KeyBinding[]>,
): string[] {
  const bindings =
    userShortcuts[id] ?? SHORTCUTS_BY_ID.get(id)?.defaultBindings ?? [];
  return bindings.map(codeMirrorKeyForBinding);
}
