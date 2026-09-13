import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { KEYRING_SERVICE, type ProviderInfo } from "@/modules/ai/config";
import {
  ArrowUpRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { ProviderIcon } from "./ProviderIcon";
import { ProviderKeyCard } from "./ProviderKeyCard";

type OAuthSession = { email?: string; name?: string };
type OAuthDeviceCode = { userCode: string; verificationUrl: string };

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function readStoredApiKey(
  keyringAccount: string,
  isApiKey: (value: string | null | undefined) => boolean,
): Promise<string | null> {
  try {
    const value = await invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account: keyringAccount,
    });
    return isApiKey(value) ? value : null;
  } catch {
    return null;
  }
}

type Props<Session extends OAuthSession, Device extends OAuthDeviceCode> = {
  provider: ProviderInfo;
  currentKey: string | null;
  onSave: (key: string) => Promise<void>;
  onClear: () => Promise<void>;
  onRemove?: () => void;
  onAuthChange: () => Promise<void>;
  isApiKey: (value: string | null | undefined) => boolean;
  readSession: () => Promise<Session | null>;
  completeLogin: (opts: {
    signal?: AbortSignal;
    onDeviceCode: (device: Device) => void;
  }) => Promise<Session>;
  clearSession: () => Promise<void>;
  blurb: string;
  signInLabel: string;
  identityFallback: string;
  deviceHelpText: string;
};

export function OAuthProviderCard<
  Session extends OAuthSession,
  Device extends OAuthDeviceCode,
>({
  provider,
  currentKey,
  onSave,
  onClear,
  onRemove,
  onAuthChange,
  isApiKey,
  readSession,
  completeLogin,
  clearSession,
  blurb,
  signInLabel,
  identityFallback,
  deviceHelpText,
}: Props<Session, Device>) {
  const [session, setSession] = useState<Session | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(
    isApiKey(currentKey) ? currentKey : null,
  );
  const [device, setDevice] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      readSession(),
      readStoredApiKey(provider.keyringAccount, isApiKey),
    ]).then(([nextSession, storedKey]) => {
      if (!alive) return;
      setSession(nextSession);
      setApiKey(isApiKey(currentKey) ? currentKey : storedKey);
    });
    return () => {
      alive = false;
    };
  }, [currentKey, readSession, provider.keyringAccount, isApiKey]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const connected = !!session || !!apiKey;
  const identity =
    session?.email || session?.name || (session ? identityFallback : null);

  const cancelLogin = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDevice(null);
    setBusy(false);
    setError(null);
  };

  const startLogin = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setBusy(true);
    try {
      const next = await completeLogin({
        signal: ac.signal,
        onDeviceCode: (code) => {
          setDevice(code);
          void openUrl(code.verificationUrl);
        },
      });
      setSession(next);
      setDevice(null);
      await onAuthChange();
    } catch (e) {
      setDevice(null);
      if (isAbortError(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setBusy(false);
    }
  };

  const signOut = async () => {
    setError(null);
    setBusy(true);
    try {
      await clearSession();
      setSession(null);
      await onAuthChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    abortRef.current?.abort();
    void (async () => {
      await clearSession();
      onRemove?.();
    })();
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <ProviderIcon provider={provider.id} size={15} />
        <span className="text-[12.5px] font-medium">{provider.label}</span>
        {connected ? (
          <Badge
            variant="outline"
            className="ml-1 h-4 gap-1 border-border/60 bg-muted/40 px-1.5 text-[10px] font-normal text-muted-foreground"
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={9}
              strokeWidth={2}
            />
            Connected
          </Badge>
        ) : null}
        <button
          type="button"
          onClick={() => void openUrl(provider.consoleUrl)}
          className="ml-auto inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Console
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            size={11}
            strokeWidth={1.75}
          />
        </button>
        {onRemove ? (
          <Button
            size="icon"
            variant="ghost"
            onClick={remove}
            title="Remove provider"
            className="size-7 text-muted-foreground hover:text-destructive"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
          </Button>
        ) : null}
      </div>

      <span className="text-[10.5px] leading-relaxed text-muted-foreground">
        {blurb}
      </span>

      {device ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted/40 px-2 py-1 font-mono text-[12px] tracking-widest text-foreground">
              {device.userCode}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void openUrl(device.verificationUrl)}
              className="h-8 gap-1 px-3 text-[11px]"
            >
              Open
              <HugeiconsIcon
                icon={ArrowUpRight01Icon}
                size={11}
                strokeWidth={1.75}
              />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={cancelLogin}
              className="h-8 px-3 text-[11px]"
            >
              Cancel
            </Button>
          </div>
          <p className="text-[10.5px] text-muted-foreground">
            {deviceHelpText}
          </p>
        </div>
      ) : session ? (
        <div className="flex items-center gap-1.5">
          <span className="flex-1 truncate text-[11.5px] text-foreground">
            {identity}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void signOut()}
            disabled={busy}
            className="h-8 px-3 text-[11px]"
          >
            Sign out
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          onClick={() => void startLogin()}
          disabled={busy}
          className="h-8 w-fit gap-1 px-3 text-[11px]"
        >
          {busy ? <Spinner className="size-3" /> : null}
          {signInLabel}
        </Button>
      )}

      {error ? <p className="text-[10.5px] text-destructive">{error}</p> : null}

      <div className="flex flex-col gap-1">
        <span className="text-[11px] tracking-tight text-muted-foreground">
          API key (optional)
        </span>
        <ProviderKeyCard
          embedded
          provider={provider}
          currentKey={apiKey}
          onSave={async (value) => {
            await onSave(value);
            setApiKey(value);
          }}
          onClear={async () => {
            await onClear();
            setApiKey(null);
          }}
        />
      </div>
    </div>
  );
}
