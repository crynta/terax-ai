import {
  type ComponentProps,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useArtifactCollection } from "@/modules/artifacts/hooks/useArtifactCollection";
import { PiControllerProvider } from "@/modules/pi/lib/PiControllerProvider";
import { PiPanel } from "@/modules/pi/PiPanel";

export type PiChatFocusRequest = {
  artifactSlug?: string | null;
  sessionId: string;
  token: number;
};

type PiChatPanelContextProps = Pick<
  ComponentProps<typeof PiPanel>,
  "activeCwd" | "activeFile" | "activeTerminalPrivate" | "workspaceRoot"
>;

type PiChatPanelProps = PiChatPanelContextProps & {
  className?: string;
  focusRequest?: PiChatFocusRequest | null;
  onOpenArtifacts?: (sessionId: string, slug?: string | null) => void;
  onSelectedSessionChange?: (sessionId: string | null) => void;
};

export function PiChatPanel({
  activeCwd = null,
  activeFile = null,
  activeTerminalPrivate = false,
  className,
  focusRequest = null,
  onOpenArtifacts,
  onSelectedSessionChange,
  workspaceRoot = null,
}: PiChatPanelProps) {
  return (
    <PiControllerProvider>
      <PiChatPanelContent
        activeCwd={activeCwd}
        activeFile={activeFile}
        activeTerminalPrivate={activeTerminalPrivate}
        className={className}
        focusRequest={focusRequest}
        onOpenArtifacts={onOpenArtifacts}
        onSelectedSessionChange={onSelectedSessionChange}
        workspaceRoot={workspaceRoot}
      />
    </PiControllerProvider>
  );
}

function PiChatPanelContent({
  activeCwd = null,
  activeFile = null,
  activeTerminalPrivate = false,
  className,
  focusRequest = null,
  onOpenArtifacts,
  onSelectedSessionChange,
  workspaceRoot = null,
}: PiChatPanelProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const lastFocusedArtifactTokenRef = useRef<number | null>(null);
  const { artifacts } = useArtifactCollection(selectedSessionId);
  const onSelectedSessionChangeRef = useRef(onSelectedSessionChange);

  useEffect(() => {
    onSelectedSessionChangeRef.current = onSelectedSessionChange;
  }, [onSelectedSessionChange]);

  useEffect(() => {
    onSelectedSessionChangeRef.current?.(selectedSessionId);
  }, [selectedSessionId]);

  useEffect(() => {
    if (!focusRequest?.artifactSlug) return;
    if (focusRequest.sessionId !== selectedSessionId) return;
    if (lastFocusedArtifactTokenRef.current === focusRequest.token) return;
    lastFocusedArtifactTokenRef.current = focusRequest.token;
    onOpenArtifacts?.(focusRequest.sessionId, focusRequest.artifactSlug);
  }, [focusRequest, onOpenArtifacts, selectedSessionId]);

  const openArtifacts = useCallback(() => {
    if (!selectedSessionId) return;
    onOpenArtifacts?.(selectedSessionId, artifacts[0]?.slug ?? null);
  }, [artifacts, onOpenArtifacts, selectedSessionId]);

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 min-w-0 overflow-hidden bg-card/80",
        className,
      )}
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <PiPanel
          activeCwd={activeCwd}
          activeFile={activeFile}
          activeTerminalPrivate={activeTerminalPrivate}
          focusRequest={
            focusRequest
              ? { sessionId: focusRequest.sessionId, token: focusRequest.token }
              : null
          }
          hideHeader={false}
          surfaceLabel="Chat"
          workspaceRoot={workspaceRoot}
          onSelectedSessionChange={setSelectedSessionId}
        />
      </div>

      {artifacts.length > 0 && selectedSessionId ? (
        <div className="absolute top-2 right-2">
          <Button size="sm" variant="secondary" onClick={openArtifacts}>
            Artifacts {artifacts.length}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
