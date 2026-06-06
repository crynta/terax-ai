import { useCallback, useEffect, useRef, useState } from "react";
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

type PiChatPanelProps = {
  className?: string;
  focusRequest?: PiChatFocusRequest | null;
  onOpenArtifacts?: (sessionId: string, slug?: string | null) => void;
  onSelectedSessionChange?: (sessionId: string | null) => void;
};

export function PiChatPanel({
  className,
  focusRequest = null,
  onOpenArtifacts,
  onSelectedSessionChange,
}: PiChatPanelProps) {
  return (
    <PiControllerProvider>
      <PiChatPanelContent
        className={className}
        focusRequest={focusRequest}
        onOpenArtifacts={onOpenArtifacts}
        onSelectedSessionChange={onSelectedSessionChange}
      />
    </PiControllerProvider>
  );
}

function PiChatPanelContent({
  className,
  focusRequest = null,
  onOpenArtifacts,
  onSelectedSessionChange,
}: PiChatPanelProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const lastFocusedArtifactTokenRef = useRef<number | null>(null);
  const { artifacts } = useArtifactCollection(selectedSessionId);

  useEffect(() => {
    onSelectedSessionChange?.(selectedSessionId);
  }, [onSelectedSessionChange, selectedSessionId]);

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
    <div className={cn("relative flex h-full min-w-0 bg-card/80", className)}>
      <div className="min-w-0 flex-1">
        <PiPanel
          focusRequest={
            focusRequest
              ? { sessionId: focusRequest.sessionId, token: focusRequest.token }
              : null
          }
          hideHeader={false}
          surfaceLabel="Chat"
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
