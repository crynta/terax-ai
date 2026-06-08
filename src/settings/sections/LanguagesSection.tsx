import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { IS_WINDOWS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  installLspBinary,
  linkLspBinary,
  LSP_LANGUAGE_GROUPS,
  probeLspBinary,
  probeWslLspBinary,
  unlinkLspBinary,
  type LspBinaryProbe,
} from "@/modules/editor/lib/lsp/languageCatalog";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setLspEnabled } from "@/modules/settings/store";
import {
  useWorkspaceEnvStore,
  type WslDistro,
} from "@/modules/workspace/env";
import { RefreshIcon, SourceCodeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

export function LanguagesSection() {
  const lspEnabled = usePreferencesStore((s) => s.lspEnabled);
  const [probes, setProbes] = useState<Record<string, LspBinaryProbe>>({});
  const [probing, setProbing] = useState(false);

  const runProbe = useCallback(async () => {
    setProbing(true);
    try {
      const results = await Promise.all(
        LSP_LANGUAGE_GROUPS.map((g) => probeLspBinary(g.command)),
      );
      const next: Record<string, LspBinaryProbe> = {};
      for (const r of results) next[r.command] = r;
      setProbes(next);
    } catch {
      /* ignore — non-Tauri dev */
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    if (lspEnabled) void runProbe();
  }, [lspEnabled, runProbe]);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Languages"
        description="Local installs first (linked path, system, Terax app data). WSL link is used only when nothing local is available."
      />

      <SettingRow
        title="Enable language servers (LSP)"
        description="Diagnostics, hover, and completions from installed servers."
      >
        <Switch
          checked={lspEnabled}
          onCheckedChange={(v) => void setLspEnabled(v)}
        />
      </SettingRow>

      {!lspEnabled ? (
        <p className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Turn on language servers to install and manage LSP binaries here.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
              Supported languages
            </span>
            <button
              type="button"
              disabled={probing}
              onClick={() => void runProbe()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-50"
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                size={12}
                strokeWidth={1.75}
                className={cn(probing && "animate-spin")}
              />
              Refresh
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {LSP_LANGUAGE_GROUPS.map((group) => (
              <LanguageGroupRow
                key={group.id}
                group={group}
                probe={probes[group.command]}
                probing={probing}
                onUpdated={(probe) =>
                  setProbes((prev) => ({ ...prev, [group.command]: probe }))
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LanguageGroupRow({
  group,
  probe,
  probing,
  onUpdated,
}: {
  group: (typeof LSP_LANGUAGE_GROUPS)[number];
  probe?: LspBinaryProbe;
  probing: boolean;
  onUpdated: (probe: LspBinaryProbe) => void;
}) {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkPath, setLinkPath] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [wslDistro, setWslDistro] = useState("");
  const [wslDetected, setWslDetected] = useState<string | null>(null);

  const distros = useWorkspaceEnvStore((s) => s.distros);
  const refreshDistros = useWorkspaceEnvStore((s) => s.refreshDistros);

  const found = probe?.found === true;
  const linked = probe?.linked === true;
  const unknown = !probe && !probing;

  useEffect(() => {
    if (linkOpen && IS_WINDOWS && distros.length === 0) {
      void refreshDistros();
    }
  }, [linkOpen, distros.length, refreshDistros]);

  useEffect(() => {
    if (!wslDistro && distros.length > 0) {
      const preferred =
        distros.find((d: WslDistro) => d.default) ?? distros[0];
      setWslDistro(preferred.name);
    }
  }, [distros, wslDistro]);

  const handleInstall = async () => {
    setInstalling(true);
    setInstallError(null);
    setProgress("Starting…");
    try {
      const result = await installLspBinary(group.command, (msg) =>
        setProgress(msg),
      );
      onUpdated(result);
      if (!result.found) {
        setInstallError(result.error ?? "Install failed");
      }
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  };

  const handleLinkPath = async () => {
    const path = linkPath.trim();
    if (!path) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      const result = await linkLspBinary(group.command, { kind: "path", path });
      onUpdated(result);
      if (result.found) {
        setLinkOpen(false);
        setLinkPath("");
      } else {
        setLinkError(result.error ?? "Link failed");
      }
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e));
    } finally {
      setLinkBusy(false);
    }
  };

  const handleDetectWsl = async () => {
    if (!wslDistro) return;
    setLinkBusy(true);
    setLinkError(null);
    setWslDetected(null);
    try {
      const path = await probeWslLspBinary(wslDistro, group.command);
      setWslDetected(path);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e));
    } finally {
      setLinkBusy(false);
    }
  };

  const handleLinkWsl = async () => {
    if (!wslDistro) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      const result = await linkLspBinary(group.command, {
        kind: "wsl",
        distro: wslDistro,
        command: wslDetected ?? group.command,
      });
      onUpdated(result);
      if (result.found) {
        setLinkOpen(false);
        setWslDetected(null);
      } else {
        setLinkError(result.error ?? "WSL link failed");
      }
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e));
    } finally {
      setLinkBusy(false);
    }
  };

  const handleUnlink = async () => {
    setLinkBusy(true);
    setLinkError(null);
    try {
      const result = await unlinkLspBinary(group.command);
      onUpdated(result);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e));
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <HugeiconsIcon
            icon={SourceCodeIcon}
            size={14}
            strokeWidth={1.75}
            className="mt-0.5 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium">{group.label}</div>
            <div className="mt-0.5 text-[10.5px] text-muted-foreground">
              {group.extensions.join(", ")}
            </div>
            <code className="mt-1.5 block truncate text-[10.5px] text-foreground/80">
              {group.command}
            </code>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <StatusBadge probe={probe} unknown={unknown} probing={probing} />
            {!probing && linked ? (
              <button
                type="button"
                disabled={linkBusy}
                onClick={() => void handleUnlink()}
                className="text-[10px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
              >
                Unlink
              </button>
            ) : !probing && found ? (
              <button
                type="button"
                disabled={linkBusy}
                onClick={() => {
                  setLinkOpen((v) => !v);
                  setLinkError(null);
                }}
                className="text-[10px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
              >
                Override
              </button>
            ) : !probing && !found ? (
              <button
                type="button"
                disabled={linkBusy}
                onClick={() => {
                  setLinkOpen((v) => !v);
                  setLinkError(null);
                }}
                className="text-[10px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
              >
                Link
              </button>
            ) : null}
          </div>
          {!found && !probing ? (
            <button
              type="button"
              disabled={installing}
              onClick={() => void handleInstall()}
              className="rounded-md bg-primary px-2.5 py-1 text-[10.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {installing ? "Installing…" : "Install for Terax"}
            </button>
          ) : null}
        </div>
      </div>

      {progress ? (
        <p className="mt-2 pl-7 text-[10px] text-muted-foreground">{progress}</p>
      ) : null}

      {(installError || linkError) && !linkOpen ? (
        <p className="mt-2 pl-7 text-[10px] text-destructive">
          {installError ?? linkError}
        </p>
      ) : null}

      {probe?.found && probe.path ? (
        <p className="mt-2 truncate pl-7 text-[10px] text-muted-foreground">
          {probe.path}
        </p>
      ) : null}

      {linkOpen ? (
        <div className="mt-3 space-y-3 border-t border-border/40 pt-3 pl-7">
          <div className="space-y-1.5">
            <label className="text-[10.5px] font-medium text-muted-foreground">
              Link local binary
            </label>
            <div className="flex gap-1.5">
              <Input
                value={linkPath}
                onChange={(e) => setLinkPath(e.target.value)}
                placeholder="C:\path\to\rust-analyzer.exe or /usr/bin/clangd"
                className="h-8 text-[11px]"
              />
              <button
                type="button"
                disabled={linkBusy || !linkPath.trim()}
                onClick={() => void handleLinkPath()}
                className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[10.5px] font-medium text-primary-foreground disabled:opacity-50"
              >
                Link
              </button>
            </div>
          </div>

          {IS_WINDOWS ? (
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-medium text-muted-foreground">
                Link from WSL
              </label>
              <div className="flex flex-wrap gap-1.5">
                <select
                  value={wslDistro}
                  onChange={(e) => {
                    setWslDistro(e.target.value);
                    setWslDetected(null);
                  }}
                  className="h-8 min-w-[8rem] rounded-md border border-border/60 bg-background px-2 text-[11px]"
                >
                  {distros.length === 0 ? (
                    <option value="">No WSL distros</option>
                  ) : (
                    distros.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  disabled={linkBusy || !wslDistro}
                  onClick={() => void handleDetectWsl()}
                  className="rounded-md border border-border/60 px-2.5 py-1 text-[10.5px] transition-colors hover:bg-accent/60 disabled:opacity-50"
                >
                  Detect
                </button>
                <button
                  type="button"
                  disabled={linkBusy || !wslDistro}
                  onClick={() => void handleLinkWsl()}
                  className="rounded-md bg-primary px-2.5 py-1 text-[10.5px] font-medium text-primary-foreground disabled:opacity-50"
                >
                  Link WSL
                </button>
              </div>
              {wslDetected ? (
                <p className="text-[10px] text-muted-foreground">
                  Found in WSL: <code>{wslDetected}</code>
                </p>
              ) : null}
            </div>
          ) : null}

          {linkError ? (
            <p className="text-[10px] text-destructive">{linkError}</p>
          ) : null}
        </div>
      ) : null}

      {probe && !probe.found && !installing && !installError && !linkOpen ? (
        <div className="mt-2 space-y-1 pl-7">
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            {group.installHint} Or link a binary you already installed (Windows
            path or WSL).
          </p>
          {group.docsUrl ? (
            <a
              href={group.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10.5px] text-primary underline-offset-2 hover:underline"
            >
              Documentation
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({
  probe,
  unknown,
  probing,
}: {
  probe?: LspBinaryProbe;
  unknown: boolean;
  probing: boolean;
}) {
  if (probing && unknown) {
    return (
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        Checking…
      </span>
    );
  }
  if (probe?.found) {
    const label = probe.wsl
      ? "WSL"
      : probe.linked
        ? "Linked"
        : probe.local
          ? "Terax"
          : "System";
    return (
      <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        {label}
      </span>
    );
  }
  if (unknown) {
    return (
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        Unknown
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
      Not installed
    </span>
  );
}
