import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Add01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  Refresh01Icon,
  ServerStack03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  LOCAL_WORKSPACE,
  workspaceDisplayLabel,
  useWorkspaceEnvStore,
  type SshWorkspaceProfile,
  type WorkspaceEnv,
} from "@/modules/workspace";
import {
  clearSshPassword,
  getSshPassword,
  setSshPassword,
} from "@/modules/workspace/sshSecrets";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setSshWorkspaces } from "@/modules/settings/store";
import { SshWorkspaceDialog } from "@/modules/workspace/SshWorkspaceDialog";
import { IS_WINDOWS } from "@/lib/platform";

type Props = {
  onSelect: (env: WorkspaceEnv) => void;
};

export function WorkspaceEnvSelector({ onSelect }: Props) {
  const env = useWorkspaceEnvStore((s) => s.env);
  const distros = useWorkspaceEnvStore((s) => s.distros);
  const loading = useWorkspaceEnvStore((s) => s.loading);
  const error = useWorkspaceEnvStore((s) => s.error);
  const refreshDistros = useWorkspaceEnvStore((s) => s.refreshDistros);
  const sshWorkspaces = usePreferencesStore((s) => s.sshWorkspaces);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | "connect">(
    "create",
  );
  const [dialogProfile, setDialogProfile] =
    useState<SshWorkspaceProfile | null>(null);
  const [deleteProfile, setDeleteProfile] =
    useState<SshWorkspaceProfile | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (open && IS_WINDOWS && distros.length === 0 && !loading) {
      void refreshDistros();
    }
  };

  const label = workspaceDisplayLabel(env);

  const saveSshWorkspace = async (
    profile: SshWorkspaceProfile,
    password: string,
  ) => {
    if (password.length > 0) {
      await setSshPassword(profile.id, password);
    }
    const next = [...sshWorkspaces, profile];
    await setSshWorkspaces(next);
    onSelect({
      kind: "ssh",
      ...profile,
      password: password.length > 0 ? password : null,
    });
  };

  const updateSshWorkspace = async (profile: SshWorkspaceProfile) => {
    const next = sshWorkspaces.map((item) =>
      item.id === profile.id ? profile : item,
    );
    await setSshWorkspaces(next);
  };

  const deleteSshWorkspace = async (profile: SshWorkspaceProfile) => {
    const next = sshWorkspaces.filter((item) => item.id !== profile.id);
    await clearSshPassword(profile.id);
    await setSshWorkspaces(next);
    if (env.kind === "ssh" && env.id === profile.id) {
      onSelect(LOCAL_WORKSPACE);
    }
    setDeleteProfile(null);
  };

  const connectSsh = async (profile: SshWorkspaceProfile) => {
    const password = await getSshPassword(profile.id);
    if (password) {
      onSelect({ kind: "ssh", ...profile, password });
      return;
    }
    setDialogMode("connect");
    setDialogProfile(profile);
    setDialogOpen(true);
  };

  const openEdit = (profile: SshWorkspaceProfile) => {
    setDialogMode("edit");
    setDialogProfile(profile);
    setDialogOpen(true);
  };

  const openCreate = () => {
    setDialogMode("create");
    setDialogProfile(null);
    setDialogOpen(true);
  };

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
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuItem onSelect={() => onSelect(LOCAL_WORKSPACE)}>
            Local
          </DropdownMenuItem>
          {IS_WINDOWS ? (
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
                    onSelect={() =>
                      onSelect({ kind: "wsl", distro: distro.name })
                    }
                  >
                    WSL: {distro.name}
                  </DropdownMenuItem>
                ))
              )}
            </>
          ) : null}
          <DropdownMenuSeparator />
          {sshWorkspaces.length === 0 ? (
            <DropdownMenuItem disabled>No SSH workspaces</DropdownMenuItem>
          ) : (
            sshWorkspaces.map((profile) => (
              <DropdownMenuSub key={profile.id}>
                <div className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-1">
                  <DropdownMenuItem
                    className="min-w-0"
                    onSelect={() => void connectSsh(profile)}
                  >
                    <span className="truncate">{profile.label}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSubTrigger
                    aria-label={`Manage ${profile.label}`}
                    className="h-9 justify-center rounded-2xl px-0 py-0 text-muted-foreground focus:text-foreground data-open:text-foreground [&_svg]:ml-0"
                  >
                    <span className="sr-only">Manage {profile.label}</span>
                  </DropdownMenuSubTrigger>
                </div>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => openEdit(profile)}>
                    <HugeiconsIcon
                      icon={PencilEdit02Icon}
                      size={13}
                      strokeWidth={1.75}
                    />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleteProfile(profile)}
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      size={13}
                      strokeWidth={1.75}
                    />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={openCreate}>
            <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={1.75} />
            Add SSH workspace
          </DropdownMenuItem>
          {IS_WINDOWS ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void refreshDistros()}>
                <HugeiconsIcon
                  icon={Refresh01Icon}
                  size={13}
                  strokeWidth={1.75}
                />
                Refresh WSL
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <SshWorkspaceDialog
        open={dialogOpen}
        mode={dialogMode}
        profile={dialogProfile}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setDialogProfile(null);
            setDialogMode("create");
          }
        }}
        onSubmit={async (profile, password) => {
          if (dialogMode === "edit") {
            await updateSshWorkspace(profile);
            return;
          }
          if (dialogMode === "connect") {
            if (password.length > 0) {
              await setSshPassword(profile.id, password);
            }
            onSelect({
              kind: "ssh",
              ...profile,
              password: password.length > 0 ? password : null,
            });
            return;
          }
          await saveSshWorkspace(profile, password);
        }}
      />
      <AlertDialog
        open={deleteProfile !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteProfile(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete SSH workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteProfile
                ? `Remove ${deleteProfile.label} and its saved password from this device.`
                : "Remove this SSH workspace and its saved password from this device."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteProfile(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleteProfile) return;
                void deleteSshWorkspace(deleteProfile);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
