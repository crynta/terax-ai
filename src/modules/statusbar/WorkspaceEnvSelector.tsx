import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IS_WINDOWS } from "@/lib/platform";
import {
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
  workspaceScopeKey,
} from "@/modules/workspace";
import { Refresh01Icon, ServerStack03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type Props = {
  env: WorkspaceEnv;
  onCreateInEnv: (env: WorkspaceEnv) => void;
};

export function WorkspaceEnvSelector({ env, onCreateInEnv }: Props) {
  const distros = useWorkspaceEnvStore((state) => state.distros);
  const loading = useWorkspaceEnvStore((state) => state.loading);
  const error = useWorkspaceEnvStore((state) => state.error);
  const refreshDistros = useWorkspaceEnvStore((state) => state.refreshDistros);

  if (!IS_WINDOWS) return null;

  const handleOpenChange = (open: boolean) => {
    if (open && distros.length === 0 && !loading) void refreshDistros();
  };

  const selectEnv = (candidate: WorkspaceEnv) => {
    if (workspaceScopeKey(candidate) !== workspaceScopeKey(env)) {
      onCreateInEnv(candidate);
    }
  };
  const label = env.kind === "wsl" ? `WSL: ${env.distro}` : "Windows";

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[state=open]:bg-accent data-[state=open]:text-foreground"
          title="Create Space in environment"
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
        <DropdownMenuItem onSelect={() => selectEnv(LOCAL_WORKSPACE)}>
          Windows Local
        </DropdownMenuItem>
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
              onSelect={() => selectEnv({ kind: "wsl", distro: distro.name })}
            >
              WSL: {distro.name}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void refreshDistros()}>
          <HugeiconsIcon icon={Refresh01Icon} size={13} strokeWidth={1.75} />
          Refresh
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
