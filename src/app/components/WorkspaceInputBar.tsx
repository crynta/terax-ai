import { cn } from "@/lib/utils";
import { AiInputBarConnect } from "@/modules/ai";
import { Chip } from "@/modules/ai/components/Chip";
import { ChipsRow } from "@/modules/ai/components/ChipsRow";
import { useComposer } from "@/modules/ai/lib/composer";
import { TerminalPromptQueue } from "@/modules/terminal/composer/TerminalPromptQueue";
import { useTerminalComposerStore } from "@/modules/terminal/composer/terminalComposerStore";
import { useBlockController } from "@/modules/terminal/lib/blockController";
import { focusLeafInput } from "@/modules/terminal/lib/useTerminalSession";
import { useTheme } from "@/modules/theme";
import {
  AiContentGenerator02Icon,
  CommandLineIcon,
  Folder01Icon,
  GitBranchIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { OsIcon } from "./OsIcon";
import { useGitBranch } from "./useGitBranch";
import { useSystemInfo } from "./useSystemInfo";

const ShellInput = lazy(() => import("@/modules/terminal/block/ShellInput"));
const AiComposerInput = lazy(() =>
  import("@/modules/ai/components/AiComposerInput").then((m) => ({
    default: m.AiComposerInput,
  })),
);
const TerminalComposer = lazy(() =>
  import("@/modules/terminal/composer/TerminalComposer").then((m) => ({
    default: m.TerminalComposer,
  })),
);

export const TOGGLE_BLOCK_INPUT_EVENT = "terax:toggle-block-input";

type Props = {
  isBlockTab: boolean;
  isTerminalTab: boolean;
  activeLeafId: number | null;
  cwd: string | null;
  home: string | null;
  hasComposer: boolean;
  panelOpen: boolean;
  keysLoaded: boolean;
  terminalComposerOpen: boolean;
  onTerminalComposerClose: () => void;
  onTerminalComposerSend: (text: string) => void;
  onConnect: () => void;
};

export function WorkspaceInputBar({
  isBlockTab,
  isTerminalTab,
  activeLeafId,
  cwd,
  home,
  hasComposer,
  panelOpen,
  keysLoaded,
  terminalComposerOpen,
  onTerminalComposerClose,
  onTerminalComposerSend,
  onConnect,
}: Props) {
  const c = useComposer();
  const { resolvedMode, themeId, customThemes } = useTheme();
  const themeKey = `${resolvedMode}:${themeId}:${customThemes.length}`;
  const { os, shell } = useSystemInfo();

  const controller = useBlockController(isBlockTab ? activeLeafId : null);
  const blockMode = controller?.blockMode ?? "prompt";

  // Re-resolve the branch chip when a command finishes (covers `git checkout`).
  const [promptNonce, setPromptNonce] = useState(0);
  const prevBlockMode = useRef(blockMode);
  useEffect(() => {
    if (prevBlockMode.current !== "prompt" && blockMode === "prompt") {
      setPromptNonce((n) => n + 1);
    }
    prevBlockMode.current = blockMode;
  }, [blockMode]);
  const branch = useGitBranch(isTerminalTab ? cwd : null, promptNonce);

  const showToggle = isBlockTab && hasComposer;
  const [mode, setMode] = useState<"shell" | "ai">("shell");
  const effectiveMode = !isBlockTab ? "ai" : hasComposer ? mode : "shell";
  const terminalComposerVisible =
    isTerminalTab && activeLeafId !== null && terminalComposerOpen;
  const terminalQueueCount = useTerminalComposerStore((state) =>
    activeLeafId === null ? 0 : (state.queues[activeLeafId]?.length ?? 0),
  );
  const terminalQueueVisible =
    isTerminalTab && activeLeafId !== null && terminalQueueCount > 0;

  const mounted =
    terminalComposerVisible || terminalQueueVisible || keysLoaded || isBlockTab;
  const open =
    terminalComposerVisible ||
    terminalQueueVisible ||
    isBlockTab ||
    (keysLoaded && panelOpen);

  const [aiLoaded, setAiLoaded] = useState(false);
  useEffect(() => {
    if (open && effectiveMode === "ai") setAiLoaded(true);
  }, [open, effectiveMode]);
  const renderAi = hasComposer && aiLoaded;

  const switchMode = (next: "shell" | "ai") => {
    setMode(next);
    requestAnimationFrame(() => {
      if (next === "ai") c.textareaRef.current?.focus();
      else if (activeLeafId != null) focusLeafInput(activeLeafId);
    });
  };

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const switchModeRef = useRef(switchMode);
  switchModeRef.current = switchMode;
  useEffect(() => {
    if (!showToggle) return;
    const onToggle = () =>
      switchModeRef.current(modeRef.current === "shell" ? "ai" : "shell");
    window.addEventListener(TOGGLE_BLOCK_INPUT_EVENT, onToggle);
    return () => window.removeEventListener(TOGGLE_BLOCK_INPUT_EVENT, onToggle);
  }, [showToggle]);

  if (!mounted) return null;

  const terminalChips = isTerminalTab ? (
    <>
      {os && <Chip tone="neutral" iconNode={<OsIcon os={os} />} title={os} />}
      {cwd && (
        <Chip tone="blue" icon={Folder01Icon} title={cwd}>
          {relPath(cwd, home)}
        </Chip>
      )}
      {branch && (
        <Chip tone="violet" icon={GitBranchIcon} title={`Branch: ${branch}`}>
          {branch}
        </Chip>
      )}
      {shell && (
        <Chip tone="emerald" icon={CommandLineIcon}>
          {shell}
        </Chip>
      )}
    </>
  ) : null;

  const content =
    !hasComposer && !isBlockTab ? (
      <AiInputBarConnect onAdd={onConnect} />
    ) : (
      <div className="shrink-0 border-t border-border/60 bg-card/40 px-3 py-2">
        <div className="flex flex-col gap-2 rounded-lg px-1 py-1">
          <ChipsRow
            leading={terminalChips}
            files={c.files}
            onRemoveFile={c.removeFile}
            snippets={c.pickedSnippets}
            onRemoveSnippet={(id) => {
              const snip = c.pickedSnippets.find((s) => s.id === id);
              c.removeSnippet(id);
              if (!snip) return;
              const re = new RegExp(`(^|\\s)#${snip.handle}\\b ?`);
              c.setValue((v) => v.replace(re, (_m, lead: string) => lead));
            }}
            commands={c.pickedCommands}
            onRemoveCommand={(name) => c.removeCommand(name)}
          />

          <div className="flex items-end gap-2.5">
            <div className="relative min-w-0 flex-1">
              {isBlockTab && controller && activeLeafId != null && (
                <div className={cn(effectiveMode !== "shell" && "hidden")}>
                  <Suspense fallback={null}>
                    <ShellInput
                      leafId={activeLeafId}
                      mode={blockMode}
                      focused={effectiveMode === "shell"}
                      themeKey={themeKey}
                      onSubmit={controller.submitCommand}
                      onInterrupt={controller.interrupt}
                      getCwd={controller.getCwd}
                    />
                  </Suspense>
                </div>
              )}
              {renderAi && (
                <div className={cn(effectiveMode !== "ai" && "hidden")}>
                  <Suspense fallback={null}>
                    <AiComposerInput />
                  </Suspense>
                </div>
              )}
            </div>
            {showToggle && (
              <div className="shrink-0 pb-px">
                <ModeToggle mode={mode} onChange={switchMode} />
              </div>
            )}
          </div>
        </div>
      </div>
    );

  return (
    <div
      data-ai-input-bar
      data-state={open ? "open" : "closed"}
      className="terax-reveal"
      aria-hidden={!open}
    >
      {terminalQueueVisible && activeLeafId !== null && (
        <TerminalPromptQueue
          leafId={activeLeafId}
          onSend={onTerminalComposerSend}
        />
      )}
      <div>
        {terminalComposerVisible && activeLeafId !== null ? (
          <Suspense fallback={null}>
            <TerminalComposer
              key={activeLeafId}
              leafId={activeLeafId}
              onSend={onTerminalComposerSend}
              onClose={onTerminalComposerClose}
            />
          </Suspense>
        ) : (
          content
        )}
      </div>
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "shell" | "ai";
  onChange: (next: "shell" | "ai") => void;
}) {
  return (
    <div className="relative grid shrink-0 grid-cols-2 rounded-md p-0.5 text-[10.5px] ring-1 ring-inset ring-border/35">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-[4px] bg-accent/60 transition-transform duration-200 ease-out"
        style={{
          transform: mode === "ai" ? "translateX(100%)" : "translateX(0)",
        }}
      />
      <SegButton
        active={mode === "shell"}
        icon={TerminalIcon}
        label="Shell"
        onClick={() => onChange("shell")}
      />
      <SegButton
        active={mode === "ai"}
        icon={AiContentGenerator02Icon}
        label="AI"
        onClick={() => onChange("ai")}
      />
    </div>
  );
}

function SegButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof AiContentGenerator02Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative z-10 flex items-center justify-center gap-1 rounded-[4px] px-2 py-[2.5px] font-medium transition-colors",
        active
          ? "text-foreground/90"
          : "text-muted-foreground/70 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={11} strokeWidth={1.75} />
      {label}
    </button>
  );
}

function relPath(p: string, home: string | null): string {
  if (!home) return p;
  const h = home.replace(/\/+$/, "");
  if (p === h || p.startsWith(`${h}/`)) return `~${p.slice(h.length)}`;
  return p;
}
