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
import { useEffect, useMemo, useRef, useState } from "react";
import type { SshWorkspaceProfile } from "./env";

type FormState = {
  label: string;
  host: string;
  user: string;
  port: string;
  rootPath: string;
  password: string;
};

const DEFAULT_ROOT = "/home";

function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function normalizeRootPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_ROOT;
  if (trimmed.length > 1 && trimmed.endsWith("/")) return trimmed.replace(/\/+$/, "");
  return trimmed;
}

export function makeSshProfile(form: FormState): SshWorkspaceProfile {
  return makeSshProfileWithId(form, newId());
}

export function makeSshProfileWithId(
  form: FormState,
  id: string,
): SshWorkspaceProfile {
  const host = form.host.trim();
  const user = form.user.trim() || null;
  const port = form.port.trim() ? Number.parseInt(form.port.trim(), 10) : null;
  const rootPath = normalizeRootPath(form.rootPath);
  const label =
    form.label.trim() ||
    `SSH: ${user ? `${user}@` : ""}${host}${port ? `:${port}` : ""}`;
  return {
    id,
    label,
    host,
    user,
    port: Number.isFinite(port ?? NaN) ? port : null,
    rootPath,
  };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit" | "connect";
  profile: SshWorkspaceProfile | null;
  onSubmit: (
    profile: SshWorkspaceProfile,
    password: string,
  ) => Promise<void> | void;
};

function emptyForm(): FormState {
  return {
    label: "",
    host: "",
    user: "",
    port: "",
    rootPath: DEFAULT_ROOT,
    password: "",
  };
}

function formFromProfile(profile: SshWorkspaceProfile | null): FormState {
  if (!profile) return emptyForm();
  return {
    label: profile.label,
    host: profile.host,
    user: profile.user ?? "",
    port: profile.port?.toString() ?? "",
    rootPath: profile.rootPath || DEFAULT_ROOT,
    password: "",
  };
}

function isConnectMode(mode: Props["mode"]): boolean {
  return mode === "connect";
}

export function SshWorkspaceDialog({
  open,
  onOpenChange,
  mode,
  profile,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<FormState>({
    ...emptyForm(),
  });
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setForm(formFromProfile(profile));
    setError(null);
    setTimeout(() => hostRef.current?.focus(), 0);
  }, [open, profile]);

  const preview = useMemo(() => {
    const host = form.host.trim();
    if (!host) return "SSH";
    const user = form.user.trim() ? `${form.user.trim()}@` : "";
    const port = form.port.trim() ? `:${form.port.trim()}` : "";
    return form.label.trim() || `SSH: ${user}${host}${port}`;
  }, [form.host, form.label, form.port, form.user]);

  const submit = async () => {
    const host = form.host.trim();
    if (!host) {
      setError("Host is required");
      return;
    }
    const rawPort = form.port.trim();
    if (rawPort && !/^\d+$/.test(rawPort)) {
      setError("Port must be numeric");
      return;
    }
    const nextProfile =
      mode !== "create" && profile
        ? makeSshProfileWithId(form, profile.id)
        : makeSshProfile(form);
    if (!nextProfile.rootPath.startsWith("/")) {
      setError("Root path must be absolute");
      return;
    }
    try {
      await onSubmit(nextProfile, form.password);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit"
              ? "Edit SSH workspace"
              : isConnectMode(mode)
                ? "Connect SSH workspace"
                : "New SSH workspace"}
          </DialogTitle>
          <DialogDescription>
            {mode === "connect"
              ? "Enter the SSH password for this workspace."
              : "Connect the explorer and source control panels to a remote root."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Input
            value={form.label}
            readOnly={mode === "connect"}
            aria-readonly={mode === "connect"}
            onChange={(e) => setForm((s) => ({ ...s, label: e.target.value }))}
            placeholder="Label"
          />
          <Input
            ref={hostRef}
            value={form.host}
            readOnly={mode === "connect"}
            aria-readonly={mode === "connect"}
            onChange={(e) => setForm((s) => ({ ...s, host: e.target.value }))}
            placeholder="Host"
          />
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <Input
              value={form.user}
              readOnly={mode === "connect"}
              aria-readonly={mode === "connect"}
              onChange={(e) => setForm((s) => ({ ...s, user: e.target.value }))}
              placeholder="User"
            />
            <Input
              value={form.port}
              readOnly={mode === "connect"}
              aria-readonly={mode === "connect"}
              onChange={(e) => setForm((s) => ({ ...s, port: e.target.value }))}
              placeholder="Port"
              inputMode="numeric"
            />
          </div>
          <Input
            value={form.rootPath}
            readOnly={mode === "connect"}
            aria-readonly={mode === "connect"}
            onChange={(e) =>
              setForm((s) => ({ ...s, rootPath: e.target.value }))
            }
            placeholder="/home/project"
          />
          <Input
            type="password"
            value={form.password}
            onChange={(e) =>
              setForm((s) => ({ ...s, password: e.target.value }))
            }
            placeholder={mode === "connect" ? "Password" : "Password"}
            autoComplete="current-password"
          />
        </div>
        {error ? (
          <div className="text-xs text-destructive">{error}</div>
        ) : (
          <div className="text-xs text-muted-foreground truncate">{preview}</div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()}>
            {mode === "edit"
              ? "Update"
              : mode === "connect"
                ? "Connect"
                : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
