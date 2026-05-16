import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IS_WINDOWS } from "@/lib/platform";
import {
  loadSshHosts,
  removeSshHost,
  saveSshHost,
  sshTestConnection,
  useWorkspaceEnvStore,
  type SshConnection,
} from "@/modules/workspace";
import {
  ComputerTerminal02Icon,
  Delete02Icon,
  EyeIcon,
  Globe02Icon,
  SaveIcon,
  ServerStack03Icon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import type { SessionOptions } from "@/modules/tabs";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (opts: SessionOptions) => void;
};

export function SessionDialog({ open, onOpenChange, onCreate }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Session</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="local">
          <TabsList className={`grid w-full ${IS_WINDOWS ? "grid-cols-3" : "grid-cols-2"}`}>
            <TabsTrigger value="local" className="justify-center">Local</TabsTrigger>
            {IS_WINDOWS && <TabsTrigger value="wsl" className="justify-center">WSL</TabsTrigger>}
            <TabsTrigger value="ssh" className="justify-center">SSH</TabsTrigger>
          </TabsList>
          <TabsContent value="local">
            <LocalSessionPane onCreate={onCreate} onDone={() => onOpenChange(false)} />
          </TabsContent>
          {IS_WINDOWS && (
            <TabsContent value="wsl">
              <WslSessionPane onCreate={onCreate} onDone={() => onOpenChange(false)} />
            </TabsContent>
          )}
          <TabsContent value="ssh">
            <SshSessionPane onCreate={onCreate} onDone={() => onOpenChange(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function LocalSessionPane({
  onCreate,
  onDone,
}: {
  onCreate: (opts: SessionOptions) => void;
  onDone: () => void;
}) {
  const shells = useWorkspaceEnvStore((s) => s.shells);
  const refreshShells = useWorkspaceEnvStore((s) => s.refreshShells);
  const [loaded, setLoaded] = useState(false);

  if (!loaded) {
    void refreshShells().then(() => setLoaded(true));
  }

  const handleCreate = (kind: string, label: string) => {
    onCreate({
      title: label,
      sessionType: kind as SessionOptions["sessionType"],
      sessionName: label,
    });
    onDone();
  };

  return (
    <div className="space-y-3 pt-2">
      <p className="text-sm text-muted-foreground">Select a local shell:</p>
      <div className="grid gap-2">
        {shells.map((shell) => (
          <Button
            key={shell.kind}
            variant="outline"
            className="justify-start gap-3 h-10"
            onClick={() => handleCreate(shell.kind, shell.label)}
          >
            <HugeiconsIcon
              icon={ComputerTerminal02Icon}
              size={18}
              strokeWidth={1.75}
            />
            <span>{shell.label}</span>
          </Button>
        ))}
        {shells.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">
            Loading available shells...
          </p>
        )}
      </div>
      <div className="pt-2">
        <Button
          variant="outline"
          className="justify-start gap-3 h-10 w-full"
          onClick={() => {
            handleCreate("local", "Default Shell");
          }}
        >
          <HugeiconsIcon
            icon={ComputerTerminal02Icon}
            size={18}
            strokeWidth={1.75}
          />
          <span>Default Shell</span>
        </Button>
      </div>
    </div>
  );
}

function WslSessionPane({
  onCreate,
  onDone,
}: {
  onCreate: (opts: SessionOptions) => void;
  onDone: () => void;
}) {
  const distros = useWorkspaceEnvStore((s) => s.distros);
  const refreshDistros = useWorkspaceEnvStore((s) => s.refreshDistros);

  const handleRemove = async (name: string) => {
    if (!window.confirm(
      `This will unregister the WSL distribution "${name}" and delete its data. Continue?`
    )) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("wsl_unregister_distro", { distro: name });
    } catch (e) {
      console.error("Failed to unregister distro:", e);
    }
    void refreshDistros();
  };

  return (
    <div className="space-y-3 pt-2">
      <p className="text-sm text-muted-foreground">
        Select a WSL distribution:
      </p>
      <div className="grid gap-2">
        {distros.length === 0 ? (
          <Button
            variant="outline"
            className="justify-start gap-3"
            onClick={() => void refreshDistros()}
          >
            <HugeiconsIcon icon={ServerStack03Icon} size={18} strokeWidth={1.75} />
            <span>Refresh WSL distros</span>
          </Button>
        ) : (
          distros.map((d) => (
            <div key={d.name} className="flex gap-2 items-center">
              <Button
                variant="outline"
                className="flex-1 justify-start gap-3 h-10"
                onClick={() => {
                  onCreate({
                    title: `WSL: ${d.name}`,
                    sessionType: "wsl",
                    sessionName: `WSL: ${d.name}`,
                    workspace: { kind: "wsl", distro: d.name },
                  });
                  onDone();
                }}
              >
                <HugeiconsIcon
                  icon={ServerStack03Icon}
                  size={18}
                  strokeWidth={1.75}
                />
                <span>
                  {d.name}
                  {d.default ? " (default)" : ""}
                </span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 shrink-0 text-muted-foreground hover:text-red-600 hover:bg-red-600/10"
                onClick={() => handleRemove(d.name)}
              >
                <HugeiconsIcon icon={Delete02Icon} size={16} strokeWidth={1.75} />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SshSessionPane({
  onCreate,
  onDone,
}: {
  onCreate: (opts: SessionOptions) => void;
  onDone: () => void;
}) {
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const [keyPath, setKeyPath] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [savedHosts, setSavedHosts] = useState<SshConnection[]>([]);

  useEffect(() => {
    void loadSshHosts().then(setSavedHosts);
  }, []);

  const fillFromSaved = (s: SshConnection) => {
    setHost(s.host);
    setUser(s.user ?? "");
    setPort(s.port ? String(s.port) : "22");
    setKeyPath(s.key_path ?? "");
    setPassword(s.password ?? "");
  };

  const handleTest = async () => {
    if (!host.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const ok = await sshTestConnection(
        host.trim(),
        user.trim() || undefined,
        port ? parseInt(port, 10) : undefined,
        keyPath.trim() || undefined,
        password || undefined,
      );
      setTestResult(ok);
    } catch {
      setTestResult(false);
    } finally {
      setTesting(false);
    }
  };

  const currentSsh = (): SshConnection => ({
    host: host.trim(),
    user: user.trim() || undefined,
    port: port ? parseInt(port, 10) : undefined,
    key_path: keyPath.trim() || undefined,
    password: password || undefined,
  });

  const handleSave = async () => {
    const s = currentSsh();
    if (!s.host) return;
    await saveSshHost(s);
    setSavedHosts(await loadSshHosts());
  };

  const handleConnect = () => {
    if (!host.trim()) return;
    const label = user
      ? `SSH: ${user}@${host}${port !== "22" ? `:${port}` : ""}`
      : `SSH: ${host}`;
    onCreate({
      title: label,
      sessionType: "ssh",
      sessionName: label,
      workspace: currentSsh(),
    });
    onDone();
  };

  return (
    <div className="space-y-3 pt-2">
      {savedHosts.length > 0 && (
        <div>
          <Label>Saved Hosts</Label>
          <div className="grid gap-1.5 pt-1">
            {savedHosts.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 justify-start gap-2 h-8 text-xs"
                  onClick={() => fillFromSaved(s)}
                >
                  <HugeiconsIcon icon={Globe02Icon} size={14} strokeWidth={1.75} />
                  <span className="truncate">
                    {s.label || `${s.user ? `${s.user}@` : ""}${s.host}${s.port && s.port !== 22 ? `:${s.port}` : ""}`}
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground hover:text-red-600 hover:bg-red-600/10"
                  onClick={async () => {
                    await removeSshHost(s.host, s.user);
                    setSavedHosts(await loadSshHosts());
                  }}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.75} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-2">
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-1">
            <Label htmlFor="ssh-user">User</Label>
            <Input
              id="ssh-user"
              placeholder="user"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor="ssh-host">Host</Label>
            <Input
              id="ssh-host"
              placeholder="hostname or IP"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="ssh-port">Port</Label>
            <Input
              id="ssh-port"
              placeholder="22"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ssh-key">Key Path (optional)</Label>
            <Input
              id="ssh-key"
              placeholder="~/.ssh/id_rsa"
              value={keyPath}
              onChange={(e) => setKeyPath(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="ssh-password">Password (optional)</Label>
          <div className="relative">
            <Input
              id="ssh-password"
              type={showPassword ? "text" : "password"}
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              className="pr-10"
            />
            <button
              type="button"
              tabIndex={-1}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword(!showPassword)}
            >
              <HugeiconsIcon
                icon={showPassword ? ViewOffIcon : EyeIcon}
                size={16}
                strokeWidth={1.75}
              />
            </button>
          </div>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testing || !host.trim()}
        >
          {testing ? "Testing..." : "Test Connection"}
        </Button>
        {testResult !== null && (
          <span
            className={`text-sm self-center ${
              testResult ? "text-green-600" : "text-red-600"
            }`}
          >
            {testResult ? "Connected!" : "Failed"}
          </span>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={handleSave}
          disabled={!host.trim()}
        >
          <HugeiconsIcon icon={SaveIcon} size={14} strokeWidth={1.75} />
          Save
        </Button>
      </div>
      <Button
        className="w-full gap-2"
        onClick={handleConnect}
        disabled={!host.trim()}
      >
        <HugeiconsIcon icon={Globe02Icon} size={16} strokeWidth={1.75} />
        Connect
      </Button>
    </div>
  );
}


