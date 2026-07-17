import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { setLspActivation } from "@/modules/settings/store";
import {
  Cancel01Icon,
  Copy01Icon,
  Loading03Icon,
  RefreshIcon,
  SourceCodeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { redetectBinary } from "../lib/detect";
import type { LspPreset } from "../lib/presets";
import { restartPresetSessions } from "../lib/sessionManager";
import { useLspHint } from "../lib/useLspHint";

type Props = {
  filePath: string | null;
};

const PILL_CLASS =
  "terax-pill-in ml-1.5 flex h-6 shrink-0 cursor-pointer [&_button]:cursor-pointer items-center gap-1 rounded-full border border-border/50 bg-accent/50 px-2 text-[10.5px] font-medium text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground";

export function LspStatusPill({ filePath }: Props) {
  const { t } = useTranslation("lsp");
  const hint = useLspHint(filePath);
  if (!hint) return null;

  if (hint.kind === "enable") {
    return (
      <span key={`enable-${hint.preset.id}`} className={PILL_CLASS}>
        <button
          type="button"
          className="flex items-center gap-1"
          onClick={() => void setLspActivation(hint.preset.id, "enabled")}
          title={t("startTitle", { command: hint.preset.command })}
        >
          <HugeiconsIcon icon={SourceCodeIcon} size={11} strokeWidth={2} />
          <span>{t("enableLsp", { name: hint.preset.name })}</span>
        </button>
        <DismissButton preset={hint.preset} />
      </span>
    );
  }

  if (hint.kind === "install") {
    return (
      <InstallPill key={`install-${hint.preset.id}`} preset={hint.preset} />
    );
  }

  if (hint.kind === "error") {
    return (
      <ErrorPill
        key={`error-${hint.preset.id}`}
        preset={hint.preset}
        reason={hint.reason}
      />
    );
  }

  return (
    <ActivePill
      key={`active-${hint.preset.id}`}
      preset={hint.preset}
      starting={hint.status === "starting"}
    />
  );
}

function ErrorPill({ preset, reason }: { preset: LspPreset; reason: string }) {
  const { t } = useTranslation("lsp");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={PILL_CLASS}
          title={t("serverStoppedTitle")}
        >
          <span className="size-1.5 rounded-full bg-destructive" />
          <span>{t("pillLabel", { name: preset.name })}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-72 p-3 text-xs [&_button]:cursor-pointer"
      >
        <div className="mb-1 font-medium text-foreground">
          {t("serverStoppedHeading", { name: preset.name })}
        </div>
        <p className="mb-2 text-muted-foreground">{reason}</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => void restartPresetSessions(preset.id)}
          >
            <HugeiconsIcon icon={RefreshIcon} size={11} strokeWidth={1.9} />
            {t("restart")}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => void setLspActivation(preset.id, "dismissed")}
          >
            {t("disable")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DismissButton({ preset }: { preset: LspPreset }) {
  const { t } = useTranslation("lsp");
  return (
    <button
      type="button"
      className="rounded-full p-0.5 hover:bg-foreground/10"
      onClick={() => void setLspActivation(preset.id, "dismissed")}
      title={t("dismissTitle")}
    >
      <HugeiconsIcon icon={Cancel01Icon} size={9} strokeWidth={2.2} />
    </button>
  );
}

function InstallPill({ preset }: { preset: LspPreset }) {
  const { t } = useTranslation("lsp");
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const install = preset.install;

  const copy = () => {
    if (!install) return;
    void navigator.clipboard.writeText(install.command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const checkAgain = () => {
    setChecking(true);
    void redetectBinary(preset.command).finally(() => setChecking(false));
  };

  return (
    <Popover>
      <span className={PILL_CLASS}>
        <PopoverTrigger asChild>
          <button type="button" className="flex items-center gap-1">
            <HugeiconsIcon icon={SourceCodeIcon} size={11} strokeWidth={2} />
            <span>{t("installLsp", { name: preset.name })}</span>
          </button>
        </PopoverTrigger>
        <DismissButton preset={preset} />
      </span>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 p-3 text-xs [&_button]:cursor-pointer"
      >
        <div className="mb-2 font-medium text-foreground">
          {t("languageServer", { name: preset.name })}
        </div>
        <p className="mb-2 text-muted-foreground">
          <Trans
            i18nKey="notFoundOnPath"
            t={t}
            values={{ command: preset.command }}
            components={{ code: <code className="text-foreground" /> }}
          />
        </p>
        {install ? (
          <div className="mb-2 flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-[11px]">
            <span className="min-w-0 flex-1 truncate select-text">
              {install.command}
            </span>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={copy}
              title={t("copyCommandTitle")}
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                size={12}
                strokeWidth={2}
              />
            </button>
          </div>
        ) : null}
        <div className="flex items-center justify-between">
          {install ? (
            <button
              type="button"
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => void openUrl(install.docsUrl).catch(console.error)}
            >
              {t("documentation")}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            onClick={checkAgain}
            disabled={checking}
          >
            {checking ? t("checking") : t("checkAgain")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ActivePill({
  preset,
  starting,
}: {
  preset: LspPreset;
  starting: boolean;
}) {
  const { t } = useTranslation("lsp");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={PILL_CLASS}
          title={
            starting ? t("serverStartingTitle") : t("serverActiveTitle")
          }
        >
          {starting ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={11}
              strokeWidth={2}
              className="animate-spin"
            />
          ) : (
            <span className="size-1.5 rounded-full bg-emerald-500" />
          )}
          <span>{t("pillLabel", { name: preset.name })}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-64 p-3 text-xs [&_button]:cursor-pointer"
      >
        <div className="mb-1 font-medium text-foreground">
          {t("languageServer", { name: preset.name })}
        </div>
        <p className="mb-2 text-muted-foreground">
          <Trans
            i18nKey={
              starting ? "runningStatus_starting" : "runningStatus_running"
            }
            t={t}
            values={{ command: preset.command }}
            components={{ code: <code className="text-foreground" /> }}
          />
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => void restartPresetSessions(preset.id)}
          >
            <HugeiconsIcon icon={RefreshIcon} size={11} strokeWidth={1.9} />
            {t("restart")}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => void setLspActivation(preset.id, "dismissed")}
          >
            {t("disable")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
