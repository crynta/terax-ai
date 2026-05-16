import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setAiAcpCommand } from "@/modules/settings/store";
import { useEffect, useState } from "react";
import { ProviderIcon } from "./ProviderIcon";

export function ClaudeAcpCard() {
  const acpCommand = usePreferencesStore((s) => s.aiAcpCommand);
  const [commandDraft, setCommandDraft] = useState(acpCommand);

  useEffect(() => setCommandDraft(acpCommand), [acpCommand]);

  const save = async () => {
    const v = commandDraft.trim();
    if (v !== acpCommand) await setAiAcpCommand(v);
  };

  const dirty = commandDraft.trim() !== acpCommand;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <ProviderIcon provider="anthropic" size={15} />
        <span className="text-[12.5px] font-medium">Claude Code</span>
        <span className="ml-auto text-[10.5px] text-muted-foreground">
          Subscription
        </span>
      </div>

      <div className="flex flex-col gap-1.5 font-mono text-[11.5px]">
        <div className="flex gap-1.5">
          <Input
            value={commandDraft}
            onChange={(e) => setCommandDraft(e.target.value)}
            onBlur={() => {
              const v = commandDraft.trim();
              if (v !== acpCommand) void setAiAcpCommand(v);
            }}
            placeholder="npx -y @zed-industries/claude-code-acp"
            spellCheck={false}
            className="h-8 flex-1"
          />
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={!dirty}
            className="h-8 px-3 text-[11px]"
          >
            Save
          </Button>
        </div>
      </div>
      <p className="text-[10px] leading-tight text-muted-foreground/70">
        Requires Claude Pro/Max. Run{" "}
        <code className="text-[9px]">claude auth</code> first.
      </p>
    </div>
  );
}
