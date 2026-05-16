import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IS_WINDOWS } from "@/lib/platform";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import {
  ComputerTerminal02Icon,
  Delete02Icon,
  IncognitoIcon,
  ServerStack03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import type { SessionOptions } from "@/modules/tabs";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (opts: SessionOptions) => void;
  isPrivate?: boolean;
};

export function SessionDialog({
  open,
  onOpenChange,
  onCreate,
  isPrivate,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isPrivate && (
              <HugeiconsIcon
                icon={IncognitoIcon}
                size={18}
                className="text-amber-600 dark:text-amber-400"
              />
            )}
            <span>{isPrivate ? "New Privacy Session" : "New Session"}</span>
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="local">
          <TabsList
            className={`grid w-full ${IS_WINDOWS ? "grid-cols-3" : "grid-cols-2"}`}
          >
            <TabsTrigger value="local" className="justify-center">
              Local
            </TabsTrigger>
            {IS_WINDOWS && (
              <TabsTrigger value="wsl" className="justify-center">
                WSL
              </TabsTrigger>
            )}
            <TabsTrigger
              value="ssh"
              tabIndex={-1}
              onClick={(e) => e.preventDefault()}
              onPointerDown={(e) => e.preventDefault()}
              className="justify-center cursor-not-allowed opacity-50 gap-2 pointer-events-auto hover:text-foreground/60 dark:hover:text-muted-foreground"
            >
              <span>SSH</span>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex size-3.5 items-center justify-center rounded-full border border-muted-foreground/30 text-[9px] font-bold leading-none text-muted-foreground/70 transition-colors hover:border-muted-foreground/50 hover:text-muted-foreground cursor-help">
                      i
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-[220px] text-[11px]"
                  >
                    SSH is currently disabled due to stability issues. Use local
                    terminals for remote access.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="local">
            <LocalSessionPane
              onCreate={onCreate}
              onDone={() => onOpenChange(false)}
            />
          </TabsContent>
          {IS_WINDOWS && (
            <TabsContent value="wsl">
              <WslSessionPane
                onCreate={onCreate}
                onDone={() => onOpenChange(false)}
              />
            </TabsContent>
          )}
          <TabsContent value="ssh">
            <div className="p-8 text-center text-muted-foreground text-sm">
              SSH is currently disabled due to stability issues. Use a local
              terminal for remote access.
            </div>
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
    if (
      !window.confirm(
        `This will unregister the WSL distribution "${name}" and delete its data. Continue?`,
      )
    )
      return;
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
            <HugeiconsIcon
              icon={ServerStack03Icon}
              size={18}
              strokeWidth={1.75}
            />
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
                <HugeiconsIcon
                  icon={Delete02Icon}
                  size={16}
                  strokeWidth={1.75}
                />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
