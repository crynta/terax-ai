import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  newTerminalPasswordId,
  type TerminalPasswordEntry,
  useTerminalPasswordStore,
} from "@/modules/terminal/lib/passwordManager";
import {
  Delete02Icon,
  Edit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { SettingRow } from "./SettingRow";

type Draft = {
  id: string;
  label: string;
  username: string;
  notes: string;
  password: string;
};

function toDraft(entry?: TerminalPasswordEntry): Draft {
  return {
    id: entry?.id ?? newTerminalPasswordId(),
    label: entry?.label ?? "",
    username: entry?.username ?? "",
    notes: entry?.notes ?? "",
    password: "",
  };
}

export function TerminalPasswordManager() {
  const hydrated = useTerminalPasswordStore((s) => s.hydrated);
  const entries = useTerminalPasswordStore((s) => s.entries);
  const hydrate = useTerminalPasswordStore((s) => s.hydrate);
  const remove = useTerminalPasswordStore((s) => s.remove);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const [editing, setEditing] = useState<TerminalPasswordEntry | null>(null);
  const [creating, setCreating] = useState(false);

  const sorted = useMemo(() => [...entries], [entries]);

  return (
    <div className="flex flex-col gap-2">
      <Label>Password Manager</Label>
      <SettingRow
        title="Terminal passwords"
        description="Store terminal secrets in your OS keychain and insert them from the command palette. Password values never go into the settings file."
      >
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-[11px]"
          onClick={() => setCreating(true)}
        >
          <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={1.75} />
          New password
        </Button>
      </SettingRow>

      {!hydrated ? (
        <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-[11px] text-muted-foreground">
          Loading password entries...
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-5 text-center text-[11px] text-muted-foreground">
          No saved passwords yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sorted.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12px] font-medium">{entry.label}</span>
                {entry.username ? (
                  <span className="truncate text-[10.5px] text-muted-foreground">
                    {entry.username}
                  </span>
                ) : null}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                title="Edit"
                onClick={() => setEditing(entry)}
              >
                <HugeiconsIcon icon={Edit02Icon} size={12} strokeWidth={1.75} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-muted-foreground hover:text-destructive"
                title="Delete"
                onClick={() => void remove(entry.id)}
              >
                <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <PasswordEditorDialog
        mode="create"
        open={creating}
        onOpenChange={setCreating}
        initial={null}
      />
      <PasswordEditorDialog
        mode="edit"
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        initial={editing}
      />
    </div>
  );
}

function PasswordEditorDialog({
  mode,
  open,
  onOpenChange,
  initial,
}: {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: TerminalPasswordEntry | null;
}) {
  const upsert = useTerminalPasswordStore((s) => s.upsert);
  const [draft, setDraft] = useState<Draft>(toDraft());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(toDraft(initial ?? undefined));
    setError(null);
    setSaving(false);
  }, [open, initial]);

  const canSave = draft.label.trim().length > 0;

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await upsert({
        id: draft.id,
        label: draft.label,
        username: draft.username,
        notes: draft.notes,
        secret: draft.password.length > 0 ? draft.password : undefined,
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save password.");
    } finally {
      setSaving(false);
    }
  };

  const passwordHint =
    mode === "create"
      ? "Required"
      : "Leave empty to keep the current password";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[14px]">
            {mode === "create" ? "New terminal password" : "Edit terminal password"}
          </DialogTitle>
        </DialogHeader>
        <div className="-mx-2 max-h-[calc(100vh-14rem)] overflow-y-auto px-2 flex flex-col gap-3">
          <Field label="Label" required>
            <Input
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="e.g. Production database"
              className="h-8 text-[12px]"
            />
          </Field>
          <Field label="Username">
            <Input
              value={draft.username}
              onChange={(e) =>
                setDraft({ ...draft, username: e.target.value })
              }
              placeholder="Optional"
              className="h-8 text-[12px]"
            />
          </Field>
          <Field label="Password" help={passwordHint} required={mode === "create"}>
            <Input
              type="password"
              value={draft.password}
              onChange={(e) =>
                setDraft({ ...draft, password: e.target.value })
              }
              placeholder={mode === "create" ? "Required" : "Unchanged"}
              className="h-8 text-[12px]"
            />
          </Field>
          <Field label="Notes">
            <Textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Optional"
              className="min-h-20 resize-y text-[12px] leading-relaxed"
            />
          </Field>
          {error ? (
            <p className="text-[11px] text-destructive">{error}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSave || saving} onClick={() => void onSave()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  required,
  help,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  help?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      {children}
      {help ? <span className="text-[10.5px] text-muted-foreground">{help}</span> : null}
    </label>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
