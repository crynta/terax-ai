import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlugIcon,
  ServerStack01Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons";
import { useState } from "react";
import { native, type SshConnectParams } from "@/modules/ai/lib/native";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: (sshRoot: string) => void;
};

function parseQuickConnect(input: string): {
  user: string;
  host: string;
  port: number;
  path?: string;
} | null {
  let s = input.trim();
  if (!s) return null;
  if (s.startsWith("ssh://")) {
    try {
      const url = new URL(s);
      if (!url.username || !url.hostname) return null;
      return {
        user: decodeURIComponent(url.username),
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : 22,
        path: url.pathname || undefined,
      };
    } catch {
      return null;
    }
  }
  const match = s.match(/^([^@]+)@([^:/]+)(?::(\d+))?(?::(.+))?$/);
  if (!match) return null;
  return {
    user: match[1],
    host: match[2],
    port: match[3] ? parseInt(match[3], 10) : 22,
    path: match[4] || undefined,
  };
}

export function SshConnectDialog({ open, onOpenChange, onConnected }: Props) {
  const [quickInput, setQuickInput] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [user, setUser] = useState("");
  const [authMode, setAuthMode] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [keyFile, setKeyFile] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setQuickInput("");
    setShowAdvanced(false);
    setName("");
    setHost("");
    setPort("22");
    setUser("");
    setAuthMode("password");
    setPassword("");
    setKeyFile("");
    setConnecting(false);
    setError(null);
  };

  const doConnect = async (params: SshConnectParams, path?: string) => {
    setConnecting(true);
    setError(null);
    try {
      const info = await native.ssh.connect(params);
      let home = path || "/";
      if (!path) {
        try {
          home = await native.ssh.resolveHome(info.name, info.user);
        } catch {}
      }
      onOpenChange(false);
      onConnected(`ssh://${info.name}${home.startsWith("/") ? home : `/${home}`}`);
      reset();
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseQuickConnect(quickInput);
    if (parsed) {
      await doConnect(
        {
          name: parsed.host,
          host: parsed.host,
          port: parsed.port,
          user: parsed.user,
          password: password || undefined,
        },
        parsed.path,
      );
      return;
    }
    if (!showAdvanced) {
      setShowAdvanced(true);
      return;
    }
    const connName = name.trim() || host.trim();
    if (!connName || !host.trim() || !user.trim()) {
      setError("Host and user are required");
      return;
    }
    await doConnect({
      name: connName,
      host: host.trim(),
      port: parseInt(port, 10) || 22,
      user: user.trim(),
      ...(authMode === "password" && password
        ? { password }
        : authMode === "key" && keyFile
          ? { key_file: keyFile }
          : {}),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={ServerStack01Icon}
              size={18}
              strokeWidth={1.75}
            />
            Connect via SSH
          </DialogTitle>
          <DialogDescription>
            user@host:port to quick connect, or expand advanced options.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ssh-quick" className="text-xs">
              SSH address
            </Label>
            <Input
              id="ssh-quick"
              value={quickInput}
              onChange={(e) => {
                setQuickInput(e.target.value);
                setError(null);
              }}
              placeholder="user@host:port"
              className="h-8 font-mono text-xs"
              autoFocus
            />
          </div>

          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="h-8 text-xs"
          />

          {error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              disabled={connecting}
              className="h-8 text-xs"
            >
              <HugeiconsIcon
                icon={PlugIcon}
                size={14}
                strokeWidth={2}
                className="mr-1.5"
              />
              {connecting ? "Connecting…" : "Connect"}
            </Button>

            <button
              type="button"
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={12}
                strokeWidth={2}
                className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`}
              />
              Advanced
            </button>
          </div>
        </form>

        {showAdvanced && (
          <form onSubmit={handleSubmit} className="grid gap-3 border-t border-border/60 pt-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ssh-name" className="text-xs">
                Connection name
              </Label>
              <Input
                id="ssh-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={host || "my-server"}
                className="h-8 text-xs"
              />
            </div>

            <div className="grid grid-cols-[1fr_80px] gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ssh-host" className="text-xs">Host</Label>
                <Input
                  id="ssh-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="192.168.1.100"
                  className="h-8 text-xs"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ssh-port" className="text-xs">Port</Label>
                <Input
                  id="ssh-port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="22"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ssh-user" className="text-xs">User</Label>
              <Input
                id="ssh-user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="root"
                className="h-8 text-xs"
              />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs">Authentication</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={authMode === "password" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setAuthMode("password")}
                >
                  Password
                </Button>
                <Button
                  type="button"
                  variant={authMode === "key" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setAuthMode("key")}
                >
                  Key file
                </Button>
              </div>
            </div>

            {authMode === "password" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="ssh-password" className="text-xs">Password</Label>
                <Input
                  id="ssh-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave empty for SSH agent"
                  className="h-8 text-xs"
                />
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="ssh-keyfile" className="text-xs">Key file path</Label>
                <Input
                  id="ssh-keyfile"
                  value={keyFile}
                  onChange={(e) => setKeyFile(e.target.value)}
                  placeholder="~/.ssh/id_ed25519"
                  className="h-8 text-xs"
                />
              </div>
            )}

            <DialogFooter>
              <Button
                type="submit"
                disabled={connecting}
                className="h-8 text-xs"
              >
                <HugeiconsIcon
                  icon={PlugIcon}
                  size={14}
                  strokeWidth={2}
                  className="mr-1.5"
                />
                {connecting ? "Connecting…" : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
