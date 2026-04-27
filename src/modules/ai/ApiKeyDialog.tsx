import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  AiBrain01Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { setOpenAiKey } from "./lib/keyring";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (key: string) => void;
};

export function ApiKeyDialog({ open, onOpenChange, onSaved }: Props) {
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setValue("");
    setReveal(false);
    setError(null);
    setSaving(false);
  };

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter your OpenAI API key.");
      return;
    }
    if (!/^sk-/.test(trimmed)) {
      setError("That doesn't look like an OpenAI key — they start with sk-.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setOpenAiKey(trimmed);
      onSaved(trimmed);
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(`Failed to save key: ${String(e)}`);
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!saving) {
          if (!o) reset();
          onOpenChange(o);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex size-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <HugeiconsIcon
              icon={AiBrain01Icon}
              size={16}
              strokeWidth={1.75}
            />
          </div>
          <DialogTitle>Connect OpenAI</DialogTitle>
          <DialogDescription>
            Terax is BYOK — your key is stored in your OS keychain and used
            only by this app. It never leaves your machine except to call the
            OpenAI API directly.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="openai-key" className="text-xs">
            OpenAI API key
          </Label>
          <div className="relative">
            <Input
              id="openai-key"
              type={reveal ? "text" : "password"}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-..."
              value={value}
              disabled={saving}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              className="pr-9 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              tabIndex={-1}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={reveal ? "Hide key" : "Show key"}
            >
              <HugeiconsIcon
                icon={reveal ? ViewOffSlashIcon : ViewIcon}
                size={14}
                strokeWidth={1.5}
              />
            </button>
          </div>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Get a key at{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              platform.openai.com/api-keys
            </a>
            .
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Spinner /> : null}
            Save & connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
