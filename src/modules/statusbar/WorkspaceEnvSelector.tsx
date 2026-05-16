import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IS_WINDOWS } from "@/lib/platform";
import {
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { Refresh01Icon, ServerStack03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSshStore } from "@/modules/ssh/store";
import { sshFingerprintSave } from "@/modules/ssh/commands";
import { FingerprintDialog } from "@/modules/ssh/FingerprintDialog";

type Props = {
  onSelect: (env: WorkspaceEnv) => void;
};

export function WorkspaceEnvSelector({ onSelect }: Props) {
  const env = useWorkspaceEnvStore((s) => s.env);
  const distros = useWorkspaceEnvStore((s) => s.distros);
  const loading = useWorkspaceEnvStore((s) => s.loading);
  const error = useWorkspaceEnvStore((s) => s.error);
  const refreshDistros = useWorkspaceEnvStore((s) => s.refreshDistros);

  const profiles = useSshStore((s) => s.profiles);
  const connState = useSshStore((s) => s.connState);
  const loadProfiles = useSshStore((s) => s.loadProfiles);
  const connect = useSshStore((s) => s.connect);

  const [tofu, setTofu] = useState<{ profileId: string; host: string; fingerprint: string } | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (open) {
      if (IS_WINDOWS && distros.length === 0 && !loading) void refreshDistros();
      if (profiles.length === 0) void loadProfiles();
    }
  };

  const handleSshSelect = async (profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;

    try {
      await connect(profileId);
      onSelect({ kind: "ssh", profileId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("TOFU_REQUIRED:")) {
        const fp = msg.slice("TOFU_REQUIRED:".length);
        setTofu({ profileId, host: profile.host, fingerprint: fp });
      } else {
        console.error("ssh connect failed", e);
      }
    }
  };

  const handleTofuAccept = async () => {
    if (!tofu) return;
    const { profileId, fingerprint } = tofu;
    setTofu(null);
    try {
      await sshFingerprintSave(profileId, fingerprint);
      await connect(profileId);
      onSelect({ kind: "ssh", profileId });
    } catch (e) {
      console.error("ssh connect failed after TOFU", e);
    }
  };

  const sshLabel = (() => {
    if (env.kind === "ssh") {
      const p = profiles.find((p) => p.id === env.profileId);
      return p ? `SSH: ${p.name}` : "SSH";
    }
    return null;
  })();

  const label =
    sshLabel ??
    (env.kind === "wsl" ? `WSL: ${env.distro}` : IS_WINDOWS ? "Windows" : "Local");

  return (
    <>
      <DropdownMenu onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0 data-[state=open]:bg-accent data-[state=open]:text-foreground"
            title="Workspace environment"
          >
            <HugeiconsIcon
              icon={ServerStack03Icon}
              size={13}
              strokeWidth={1.75}
            />
            <span className="max-w-28 truncate">{label}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          <DropdownMenuItem onSelect={() => onSelect(LOCAL_WORKSPACE)}>
            {IS_WINDOWS ? "Windows Local" : "Local"}
          </DropdownMenuItem>

          {IS_WINDOWS && (
            <>
              <DropdownMenuSeparator />
              {distros.length === 0 ? (
                <DropdownMenuItem disabled>
                  {loading
                    ? "Loading WSL distros..."
                    : error
                      ? "WSL unavailable"
                      : "No WSL distros found"}
                </DropdownMenuItem>
              ) : (
                distros.map((distro) => (
                  <DropdownMenuItem
                    key={distro.name}
                    onSelect={() => onSelect({ kind: "wsl", distro: distro.name })}
                  >
                    WSL: {distro.name}
                  </DropdownMenuItem>
                ))
              )}
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] font-normal text-muted-foreground py-0.5">
            SSH
          </DropdownMenuLabel>
          {profiles.length === 0 ? (
            <DropdownMenuItem disabled>No SSH profiles saved</DropdownMenuItem>
          ) : (
            profiles.map((profile) => {
              const state = connState[profile.id];
              const isConnecting = state === "connecting";
              return (
                <DropdownMenuItem
                  key={profile.id}
                  onSelect={() => void handleSshSelect(profile.id)}
                  disabled={isConnecting}
                >
                  {profile.name}
                  {isConnecting && (
                    <span className="ml-auto text-[10px] text-muted-foreground">connecting…</span>
                  )}
                  {state === "connected" && (
                    <span className="ml-auto text-[10px] text-green-500">●</span>
                  )}
                  {state === "error" && (
                    <span className="ml-auto text-[10px] text-destructive">!</span>
                  )}
                </DropdownMenuItem>
              );
            })
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void refreshDistros()}>
            <HugeiconsIcon icon={Refresh01Icon} size={13} strokeWidth={1.75} />
            Refresh
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {tofu && (
        <FingerprintDialog
          open
          host={tofu.host}
          fingerprint={tofu.fingerprint}
          onAccept={() => void handleTofuAccept()}
          onReject={() => setTofu(null)}
        />
      )}
    </>
  );
}
