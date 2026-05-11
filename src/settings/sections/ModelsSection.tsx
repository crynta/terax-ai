import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  AUTOCOMPLETE_PROVIDERS,
  DEFAULT_AUTOCOMPLETE_MODEL,
  MODELS,
  PROVIDERS,
  getModel,
  getProvider,
  providerNeedsKey,
  type AutocompleteProviderId,
  type ModelId,
  type ProviderId,
} from "@/modules/ai/config";
import { clearKey, getAllKeys, setKey } from "@/modules/ai/lib/keyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  emitKeysChanged,
  setAutocompleteEnabled,
  setAutocompleteModelId,
  setAutocompleteProvider,
  setDefaultModel,
  setLmstudioBaseURL,
} from "@/modules/settings/store";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  GithubIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { ProviderIcon } from "../components/ProviderIcon";
import { ProviderKeyCard } from "../components/ProviderKeyCard";
import { SectionHeader } from "../components/SectionHeader";

type KeysMap = Record<ProviderId, string | null>;

type DeviceFlowStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

type CopilotOAuthState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "pending"; flow: DeviceFlowStart }
  | { kind: "connected" }
  | { kind: "error"; message: string };

export function ModelsSection() {
  const [keys, setKeys] = useState<KeysMap | null>(null);
  const defaultModel = usePreferencesStore((s) => s.defaultModelId);

  useEffect(() => {
    void getAllKeys().then(setKeys);
  }, []);

  const onSave = async (provider: ProviderId, value: string) => {
    await setKey(provider, value);
    setKeys((prev) => (prev ? { ...prev, [provider]: value } : prev));
    await emitKeysChanged();
  };

  const onClear = async (provider: ProviderId) => {
    await clearKey(provider);
    setKeys((prev) => (prev ? { ...prev, [provider]: null } : prev));
    await emitKeysChanged();
  };

  // Sync copilot key into keys state after OAuth connects
  const onCopilotConnected = async (token: string) => {
    await onSave("copilot", token);
  };

  const onCopilotDisconnect = async () => {
    await onClear("copilot");
  };

  if (!keys) {
    return <div className="text-[12px] text-muted-foreground">Loading…</div>;
  }

  const defaultModelInfo = getModel(defaultModel);
  // Providers shown in the generic API key grid — exclude copilot (has dedicated OAuth UI)
  const keyProviders = PROVIDERS.filter(
    (p) => providerNeedsKey(p.id) && p.id !== "copilot",
  );
  const configuredCount = keyProviders.filter((p) => !!keys[p.id]).length;

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="Models"
        description="Bring your own keys. They live in your OS keychain and are used only by Terax."
      />

      <div className="flex flex-col gap-2">
        <Label>Default model</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-9 justify-between gap-2 px-2.5 text-[12px]"
            >
              <span className="flex items-center gap-2">
                <ProviderIcon provider={defaultModelInfo.provider} size={14} />
                <span>{defaultModelInfo.label}</span>
                <span className="text-muted-foreground">
                  · {defaultModelInfo.hint}
                </span>
              </span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={12}
                strokeWidth={2}
                className="opacity-70"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[260px]">
            {PROVIDERS.filter((p) => providerNeedsKey(p.id)).map((p) => {
              const models = MODELS.filter((m) => m.provider === p.id);
              const hasKey = !!keys[p.id];
              return (
                <div key={p.id} className="px-1 pt-1.5">
                  <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    <ProviderIcon provider={p.id} size={11} />
                    <span>{p.label}</span>
                    {!hasKey && (
                      <span className="ml-auto text-[9.5px] normal-case tracking-normal text-muted-foreground/70">
                        no key
                      </span>
                    )}
                  </div>
                  {models.map((m) => (
                    <DropdownMenuItem
                      key={m.id}
                      disabled={!hasKey}
                      onSelect={() =>
                        hasKey && void setDefaultModel(m.id as ModelId)
                      }
                      className={cn(
                        "flex items-center justify-between gap-2 text-[12px]",
                        m.id === defaultModel && "bg-accent/50",
                      )}
                    >
                      <span className="flex flex-col">
                        <span>{m.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {m.hint}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </div>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CopilotOAuthCard
        connected={!!keys.copilot}
        onConnected={onCopilotConnected}
        onDisconnect={onCopilotDisconnect}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Label>API keys</Label>
          <span className="text-[10.5px] text-muted-foreground">
            {configuredCount} of {keyProviders.length} configured
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {keyProviders.map((p) => (
            <ProviderKeyCard
              key={p.id}
              provider={p}
              currentKey={keys[p.id]}
              onSave={(v: string) => onSave(p.id, v)}
              onClear={() => onClear(p.id)}
            />
          ))}
        </div>
      </div>

      <AutocompleteBlock keys={keys} />
    </div>
  );
}

function CopilotOAuthCard({
  connected,
  onConnected,
  onDisconnect,
}: {
  connected: boolean;
  onConnected: (token: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
}) {
  const [state, setState] = useState<CopilotOAuthState>(
    connected ? { kind: "connected" } : { kind: "idle" },
  );
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync prop → state when the key is cleared externally
  useEffect(() => {
    if (!connected && state.kind === "connected") {
      setState({ kind: "idle" });
    }
  }, [connected, state.kind]);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const startConnect = async () => {
    setState({ kind: "loading" });

    // Fast path: try to import from `gh auth token` if gh CLI is available
    try {
      const ghToken = await invoke<string | null>("copilot_try_gh_token");
      if (ghToken) {
        await onConnected(ghToken);
        setState({ kind: "connected" });
        return;
      }
    } catch {
      // gh CLI not available — fall through to device flow
    }

    // Device Flow
    try {
      const flow = await invoke<DeviceFlowStart>("copilot_oauth_start");
      setState({ kind: "pending", flow });
      // Open verification URL in browser
      await openUrl(flow.verificationUri);
      // Start polling
      const interval = Math.max((flow.interval ?? 5) * 1000, 5000);
      pollTimer.current = setInterval(async () => {
        try {
          const result = await invoke<{ accessToken: string | null; status: string }>(
            "copilot_oauth_poll",
            { deviceCode: flow.deviceCode },
          );
          if (result.accessToken) {
            stopPolling();
            await onConnected(result.accessToken);
            setState({ kind: "connected" });
          } else if (
            result.status === "expired_token" ||
            result.status === "access_denied"
          ) {
            stopPolling();
            setState({
              kind: "error",
              message:
                result.status === "access_denied"
                  ? "Authorization denied."
                  : "Code expired. Please try again.",
            });
          }
          // "authorization_pending" and "slow_down" → keep polling
        } catch (e) {
          stopPolling();
          setState({ kind: "error", message: String(e) });
        }
      }, interval);
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  };

  const disconnect = async () => {
    stopPolling();
    await onDisconnect();
    setState({ kind: "idle" });
  };

  const cancel = () => {
    stopPolling();
    setState({ kind: "idle" });
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>GitHub Copilot</Label>
      <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
        {state.kind === "connected" ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <HugeiconsIcon
                icon={GithubIcon}
                size={16}
                strokeWidth={1.75}
                className="shrink-0"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-[12.5px] font-medium">GitHub Copilot</span>
                <span className="flex items-center gap-1 text-[10.5px] text-emerald-500">
                  <HugeiconsIcon icon={Tick01Icon} size={11} strokeWidth={2} />
                  Connected — models are ready to use
                </span>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void disconnect()}
              className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.75} />
              Disconnect
            </Button>
          </div>
        ) : state.kind === "pending" ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-start gap-2.5">
              <HugeiconsIcon
                icon={GithubIcon}
                size={16}
                strokeWidth={1.75}
                className="mt-0.5 shrink-0"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-[12.5px] font-medium">Waiting for authorization…</span>
                <span className="text-[10.5px] leading-relaxed text-muted-foreground">
                  A browser window has opened. Enter the code below on GitHub, then
                  come back — this will connect automatically.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-border bg-muted px-3 py-1.5 font-mono text-[15px] font-semibold tracking-widest">
                {state.flow.userCode}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2.5 text-[11px]"
                onClick={() => void openUrl(state.flow.verificationUri)}
              >
                Reopen browser
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-8 px-2.5 text-[11px] text-muted-foreground"
                onClick={cancel}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <HugeiconsIcon
                icon={GithubIcon}
                size={16}
                strokeWidth={1.75}
                className="mt-0.5 shrink-0"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-[12.5px] font-medium">Sign in with GitHub</span>
                <span className="text-[10.5px] leading-relaxed text-muted-foreground">
                  Connect your GitHub account to use models included in your
                  Copilot subscription — GPT-4o, Claude, Gemini and more.
                </span>
                {state.kind === "error" && (
                  <span className="mt-0.5 text-[10.5px] text-destructive">
                    {state.message}
                  </span>
                )}
              </div>
            </div>
            <Button
              size="sm"
              disabled={state.kind === "loading"}
              onClick={() => void startConnect()}
              className="h-8 shrink-0 gap-1.5 px-2.5 text-[11px]"
            >
              {state.kind === "loading" ? (
                "Connecting…"
              ) : (
                <>
                  <HugeiconsIcon icon={GithubIcon} size={12} strokeWidth={1.75} />
                  Connect
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function AutocompleteBlock({ keys }: { keys: KeysMap }) {
  const enabled = usePreferencesStore((s) => s.autocompleteEnabled);
  const provider = usePreferencesStore((s) => s.autocompleteProvider);
  const modelId = usePreferencesStore((s) => s.autocompleteModelId);
  const lmstudioBaseURL = usePreferencesStore((s) => s.lmstudioBaseURL);

  const [modelDraft, setModelDraft] = useState(modelId);
  const [urlDraft, setUrlDraft] = useState(lmstudioBaseURL);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "ok" | "fail"
  >("idle");

  useEffect(() => setModelDraft(modelId), [modelId]);
  useEffect(() => setUrlDraft(lmstudioBaseURL), [lmstudioBaseURL]);

  const onProviderChange = (next: AutocompleteProviderId) => {
    void setAutocompleteProvider(next);
    const knownDefaults = Object.values(DEFAULT_AUTOCOMPLETE_MODEL);
    if (knownDefaults.includes(modelId)) {
      void setAutocompleteModelId(DEFAULT_AUTOCOMPLETE_MODEL[next]);
    }
  };

  const providerInfo = getProvider(provider);
  const hasKey = providerNeedsKey(provider) ? !!keys[provider] : true;

  const testLmStudio = async () => {
    setTestStatus("testing");
    try {
      const url = urlDraft.replace(/\/$/, "") + "/models";
      const status = await invoke<number>("http_ping", { url });
      setTestStatus(status >= 200 && status < 400 ? "ok" : "fail");
    } catch {
      setTestStatus("fail");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Label>Editor autocomplete</Label>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            Inline ghost-text suggestions in the code editor. Powered by
            ultra-fast inference (Cerebras / Groq) or a local LM Studio server.
          </span>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => void setAutocompleteEnabled(v)}
        />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
        <div className="flex flex-col gap-1.5">
          <Label>Provider</Label>
          <div className="flex gap-1">
            {AUTOCOMPLETE_PROVIDERS.map((id) => {
              const info = getProvider(id);
              const active = id === provider;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onProviderChange(id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] transition-colors",
                    active
                      ? "border-foreground/40 bg-accent/60"
                      : "border-border/60 bg-transparent hover:bg-accent/30",
                  )}
                >
                  <ProviderIcon provider={id} size={12} />
                  <span>{info.label}</span>
                </button>
              );
            })}
          </div>
          {!hasKey ? (
            <span className="text-[10.5px] text-amber-500">
              No API key configured for {providerInfo.label}. Add one above.
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Model</Label>
          <Input
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            onBlur={() => {
              const v = modelDraft.trim();
              if (v && v !== modelId) void setAutocompleteModelId(v);
            }}
            placeholder={DEFAULT_AUTOCOMPLETE_MODEL[provider]}
            spellCheck={false}
            className="h-8 font-mono text-[11.5px]"
          />
        </div>

        {provider === "lmstudio" ? (
          <div className="flex flex-col gap-1.5">
            <Label>LM Studio base URL</Label>
            <div className="flex gap-1.5">
              <Input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onBlur={() => {
                  const v = urlDraft.trim();
                  if (v && v !== lmstudioBaseURL) void setLmstudioBaseURL(v);
                }}
                placeholder="http://localhost:1234/v1"
                spellCheck={false}
                className="h-8 flex-1 font-mono text-[11.5px]"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void testLmStudio()}
                className="h-8 px-2.5 text-[11px]"
              >
                Test
              </Button>
            </div>
            {testStatus === "ok" ? (
              <span className="text-[10.5px] text-emerald-500">
                Connected — server responded.
              </span>
            ) : testStatus === "fail" ? (
              <span className="text-[10.5px] text-destructive">
                Could not reach the server. Is LM Studio running?
              </span>
            ) : testStatus === "testing" ? (
              <span className="text-[10.5px] text-muted-foreground">
                Testing…
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
