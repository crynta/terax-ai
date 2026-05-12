import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ProviderInfo } from "@/modules/ai/config";
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { ProviderIcon } from "./ProviderIcon";

type Props = {
  provider: ProviderInfo;
  currentKey: string | null;
  onSave: (key: string) => Promise<void>;
  onClear: () => Promise<void>;
};

function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(8)}${key.slice(-4)}`;
}

export function ProviderKeyCard({
  provider,
  currentKey,
  onSave,
  onClear,
}: Props) {
  const [editing, setEditing] = useState(!currentKey);
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(!currentKey);
  }, [currentKey]);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter your API key.");
      return;
    }
    if (provider.keyPrefix && !trimmed.startsWith(provider.keyPrefix)) {
      setError(`${provider.label} keys start with "${provider.keyPrefix}".`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      setValue("");
      setReveal(false);
    } catch (e) {
      setError(`Failed to save: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setValue("");
    setReveal(false);
    setError(null);
    setEditing(!currentKey);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5",
      )}
    >
      <div className="flex items-center gap-2">
        <ProviderIcon provider={provider.id} size={16} />
        <span className="text-[12.5px] font-medium">{provider.label}</span>
        {currentKey ? (
          <Badge
            variant="outline"
            className="ml-1 h-4 gap-1 border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-300"
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={9}
              strokeWidth={2}
            />
            Configured
          </Badge>
        ) : null}
        {provider.consoleUrl ? (
          <button
            type="button"
            onClick={() => void openUrl(provider.consoleUrl)}
            className="ml-auto text-[10.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Get key
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <Input
              type={reveal ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder={
                provider.keyPrefix ? `${provider.keyPrefix}…` : "Paste API key"
              }
              value={value}
              disabled={saving}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              className="h-8 pr-8 font-mono text-[11.5px]"
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              tabIndex={-1}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={reveal ? "Hide key" : "Show key"}
            >
              <HugeiconsIcon
                icon={reveal ? ViewOffSlashIcon : ViewIcon}
                size={12}
                strokeWidth={1.75}
              />
            </button>
          </div>
          {error ? (
            <p className="text-[10.5px] text-destructive">{error}</p>
          ) : null}
          <div className="flex justify-end gap-1.5">
            {currentKey ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={cancel}
                disabled={saving}
                className="h-7 px-2 text-[11px]"
              >
                Cancel
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={saving}
              className="h-7 gap-1 px-2.5 text-[11px]"
            >
              {saving ? <Spinner className="size-3" /> : null}
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
            {maskKey(currentKey ?? "")}
          </code>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setEditing(true)}
            title="Replace"
            className="size-7"
          >
            <HugeiconsIcon icon={Edit02Icon} size={12} strokeWidth={1.75} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void onClear()}
            title="Remove"
            className="size-7 text-muted-foreground hover:text-destructive"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
          </Button>
        </div>
      )}
    </div>
  );
}
