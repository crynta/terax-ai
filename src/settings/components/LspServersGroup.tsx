import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  allServers,
  detectBinary,
  type LspPreset,
  redetectBinary,
  useLspRuntimeStore,
} from "@/modules/lsp";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type LspCustomServer,
  setLspActivation,
  setLspCustomServers,
} from "@/modules/settings/store";
import { Delete02Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useId, useState } from "react";
import { SettingRow } from "./SettingRow";

export function LspServersGroup() {
  const activation = usePreferencesStore((s) => s.lspActivation);
  const customServers = usePreferencesStore((s) => s.lspCustomServers);
  const servers = allServers(customServers);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>Language servers</Label>
        <AddCustomServerDialog customServers={customServers} />
      </div>
      {servers.map((server) => (
        <ServerRow
          key={server.id}
          server={server}
          enabled={activation[server.id] === "enabled"}
          custom={customServers.some((c) => c.id === server.id)}
          customServers={customServers}
        />
      ))}
    </div>
  );
}

function ServerRow({
  server,
  enabled,
  custom,
  customServers,
}: {
  server: LspPreset;
  enabled: boolean;
  custom: boolean;
  customServers: LspCustomServer[];
}) {
  const detected = useLspRuntimeStore((s) => s.detected[server.command]);

  useEffect(() => {
    void detectBinary(server.command);
  }, [server.command]);

  const langs = Object.keys(server.languages).join(", ");
  const status =
    detected === undefined
      ? "checking..."
      : detected
        ? detected
        : "not found on PATH";

  return (
    <SettingRow
      title={
        <span className="flex items-center gap-1.5">
          {server.name}
          {detected ? (
            <span className="size-1.5 rounded-full bg-emerald-500" />
          ) : null}
        </span>
      }
      description={`${server.command} (${langs}) - ${status}`}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => void redetectBinary(server.command)}
          title="Detect again"
        >
          <HugeiconsIcon icon={Refresh01Icon} size={12} strokeWidth={1.75} />
        </button>
        {custom ? (
          <button
            type="button"
            className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
            onClick={() => {
              void setLspActivation(server.id, null);
              void setLspCustomServers(
                customServers.filter((c) => c.id !== server.id),
              );
            }}
            title="Remove server"
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
          </button>
        ) : null}
        <Switch
          checked={enabled}
          onCheckedChange={(v) =>
            void setLspActivation(server.id, v ? "enabled" : "dismissed")
          }
        />
      </div>
    </SettingRow>
  );
}

function AddCustomServerDialog({
  customServers,
}: {
  customServers: LspCustomServer[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [extensions, setExtensions] = useState("");
  const [languageId, setLanguageId] = useState("");
  const [rootMarkers, setRootMarkers] = useState("");
  const formId = useId();

  const parsedExts = extensions
    .split(",")
    .map((s) => s.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean);
  const valid =
    name.trim().length > 0 &&
    command.trim().length > 0 &&
    parsedExts.length > 0;

  const save = () => {
    if (!valid) return;
    const langId = languageId.trim() || (parsedExts[0] ?? "");
    const id = `custom-${command.trim()}`;
    const server: LspCustomServer = {
      id,
      name: name.trim(),
      command: command.trim(),
      args: args.trim() ? args.trim().split(/\s+/) : [],
      languages: Object.fromEntries(parsedExts.map((e) => [e, langId])),
      rootMarkers: rootMarkers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    void setLspCustomServers([
      ...customServers.filter((c) => c.id !== id),
      server,
    ]);
    void setLspActivation(id, "enabled");
    setOpen(false);
    setName("");
    setCommand("");
    setArgs("");
    setExtensions("");
    setLanguageId("");
    setRootMarkers("");
  };

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
  ) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${formId}-${label}`} className="text-[11px]">
        {label}
      </Label>
      <Input
        id={`${formId}-${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 text-xs"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]">
          Add custom server
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Custom language server</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2.5">
          {field("Name", name, setName, "Zig")}
          {field("Command", command, setCommand, "zls")}
          {field("Arguments", args, setArgs, "--stdio")}
          {field("File extensions", extensions, setExtensions, "zig, zon")}
          {field("LSP language id", languageId, setLanguageId, "zig")}
          {field("Root markers", rootMarkers, setRootMarkers, "build.zig")}
        </div>
        <DialogFooter>
          <Button size="sm" disabled={!valid} onClick={save}>
            Add server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
