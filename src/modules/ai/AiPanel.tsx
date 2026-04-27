import { Button } from "@/components/ui/button";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { AiBrain01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { AiChatView } from "./AiChat";
import { AiInput, type AiInputHandle } from "./AiInput";
import { ApiKeyDialog } from "./ApiKeyDialog";
import { getOrCreateChat, useChatStore } from "./lib/chatStore";
import { getOpenAiKey } from "./lib/keyring";

export type AiPanelHandle = {
  focus: () => void;
  prefill: (text: string) => void;
};

type Props = {
  tabId: number;
  onClose?: () => void;
};

export const AiPanel = forwardRef<AiPanelHandle, Props>(function AiPanel(
  { tabId, onClose },
  ref,
) {
  const apiKey = useChatStore((s) => s.apiKey);
  const setApiKey = useChatStore((s) => s.setApiKey);
  const [loaded, setLoaded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const inputRef = useRef<AiInputHandle | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    prefill: (text) => {
      inputRef.current?.setValue(text);
      inputRef.current?.focus();
    },
  }));

  useEffect(() => {
    let alive = true;
    getOpenAiKey().then((k) => {
      if (!alive) return;
      setApiKey(k);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [setApiKey]);

  if (!loaded) return null;

  if (!apiKey) {
    return (
      <>
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
          <HugeiconsIcon icon={AiBrain01Icon} size={22} strokeWidth={1.5} />
          <div className="space-y-1">
            <p className="text-sm text-foreground">Connect OpenAI to start</p>
            <p className="text-xs">
              Terax is BYOK. Your key stays in your OS keychain.
            </p>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            Add API key
          </Button>
        </div>
        <ApiKeyDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSaved={(k) => setApiKey(k)}
        />
      </>
    );
  }

  return (
    <ConnectedPanel
      tabId={tabId}
      apiKey={apiKey}
      onClose={onClose}
      inputRef={inputRef}
    />
  );
});

function ConnectedPanel({
  tabId,
  apiKey,
  onClose,
  inputRef,
}: {
  tabId: number;
  apiKey: string;
  onClose?: () => void;
  inputRef: React.RefObject<AiInputHandle | null>;
}) {
  const chat = useMemo(() => getOrCreateChat(tabId, apiKey), [tabId, apiKey]);
  const helpers = useChat<UIMessage>({ chat });
  const isBusy =
    helpers.status === "submitted" || helpers.status === "streaming";

  return (
    <div className="flex h-full flex-col">
      <AiChatView
        messages={helpers.messages}
        status={helpers.status}
        error={helpers.error}
        clearError={helpers.clearError}
        addToolApprovalResponse={helpers.addToolApprovalResponse}
        stop={helpers.stop}
      />
      <AiInput
        ref={inputRef}
        busy={isBusy}
        onSubmit={(prompt) => {
          void helpers.sendMessage({ text: prompt });
        }}
        onStop={() => void helpers.stop()}
        onClose={onClose}
      />
    </div>
  );
}
