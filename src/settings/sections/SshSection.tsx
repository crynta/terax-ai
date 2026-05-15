import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSshStore } from "@/modules/ssh/store";
import type { SshProfile, AuthMethod } from "@/modules/ssh/types";
import { Delete02Icon, Add01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

const BLANK: Omit<SshProfile, "id"> = {
  name: "",
  host: "",
  port: 22,
  user: "",
  authMethod: "key",
  keyPath: "",
};

export function SshSection() {
  const profiles = useSshStore((s) => s.profiles);
  const loadProfiles = useSshStore((s) => s.loadProfiles);
  const saveProfile = useSshStore((s) => s.saveProfile);
  const deleteProfile = useSshStore((s) => s.deleteProfile);

  const [editing, setEditing] = useState<(Omit<SshProfile, "id"> & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const startNew = () => {
    setEditing({ ...BLANK });
    setError(null);
  };

  const startEdit = (p: SshProfile) => {
    setEditing({ ...p });
    setError(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.host.trim() || !editing.user.trim()) {
      setError("Name, host, and user are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveProfile(editing);
      setEditing(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteProfile(id);
    if (editing && editing.id === id) setEditing(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold">SSH Profiles</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Saved SSH connections. Profiles are stored in your app data directory.
        </p>
      </div>

      <div className="space-y-1">
        {profiles.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">No profiles yet.</p>
        )}
        {profiles.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{p.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {p.user}@{p.host}:{p.port} · {p.authMethod}
              </p>
            </div>
            <div className="flex shrink-0 gap-1 ml-2">
              <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => void handleDelete(p.id)}
              >
                <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.75} />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {editing ? (
        <div className="space-y-3 rounded-md border border-border/60 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {editing.id ? "Edit Profile" : "New Profile"}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Name</label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Production"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Host</label>
              <Input
                value={editing.host}
                onChange={(e) => setEditing({ ...editing, host: e.target.value })}
                placeholder="192.168.1.1"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">User</label>
              <Input
                value={editing.user}
                onChange={(e) => setEditing({ ...editing, user: e.target.value })}
                placeholder="alice"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Port</label>
              <Input
                type="number"
                value={editing.port}
                onChange={(e) =>
                  setEditing({ ...editing, port: parseInt(e.target.value, 10) || 22 })
                }
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Auth method</label>
            <div className="flex gap-3">
              {(["key", "agent"] as AuthMethod[]).map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="authMethod"
                    value={m}
                    checked={editing.authMethod === m}
                    onChange={() => setEditing({ ...editing, authMethod: m })}
                  />
                  {m === "key" ? "Key file" : "SSH agent"}
                </label>
              ))}
            </div>
          </div>
          {editing.authMethod === "key" && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Key path</label>
              <Input
                value={editing.keyPath ?? ""}
                onChange={(e) => setEditing({ ...editing, keyPath: e.target.value })}
                placeholder="~/.ssh/id_ed25519"
              />
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} strokeWidth={1.75} />
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={startNew}>
          <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={1.75} />
          Add Profile
        </Button>
      )}
    </div>
  );
}
