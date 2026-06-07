import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import ChevronDown from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  CustomEndpoint,
  ProviderId,
  ProviderInfo,
} from "@/modules/ai/config";
import { ModelIdBrowseField } from "../components/ModelIdBrowseField";
import { ProviderIcon } from "../components/ProviderIcon";
import {
  FieldRow,
  isLocalProvider,
  type LocalConfig,
  type LocalMeta,
  StatusLine,
} from "./ModelsSectionShared";

type ProviderEndpointTestStatus = "idle" | "testing" | "ok" | "fail";

export function parseProviderContextLimitDraft(
  draft: string,
  currentLimit: number | undefined,
): { ok: true; value: number } | { ok: false; resetValue: string } {
  const value = Number.parseInt(draft, 10);
  if (Number.isFinite(value) && value >= 1000) {
    return { ok: true, value };
  }
  return { ok: false, resetValue: String(currentLimit ?? "") };
}

export function maskedProviderKey(key: string): string {
  return `${key.slice(0, 4)}${"•".repeat(8)}${key.slice(-4)}`;
}

export function providerPingStatus(status: number): "ok" | "fail" {
  return status > 0 ? "ok" : "fail";
}

function useSyncedDraft(value: string) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return [draft, setDraft] as const;
}

function useProviderEndpointTest() {
  const [testStatus, setTestStatus] =
    useState<ProviderEndpointTestStatus>("idle");

  const testEndpoint = async (baseUrl: string) => {
    setTestStatus("testing");
    try {
      const status = await invoke<number>("lm_ping", { baseUrl });
      setTestStatus(providerPingStatus(status));
    } catch {
      setTestStatus("fail");
    }
  };

  return { testEndpoint, testStatus };
}

export function AddProviderMenu({
  providers,
  onAdd,
  onAddCompat,
}: {
  providers: readonly ProviderInfo[];
  onAdd: (id: ProviderId) => void;
  onAddCompat: () => void;
}) {
  const cloud = providers.filter((p) => !isLocalProvider(p.id));
  const local = providers.filter(
    (p) => isLocalProvider(p.id) && p.id !== "openai-compatible",
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2.5 text-[11px]"
        >
          <HugeiconsIcon
            data-icon="inline-start"
            icon={Add01Icon}
            strokeWidth={2}
          />
          Add provider
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-55 p-1">
        {cloud.length > 0 ? (
          <>
            <DropdownMenuLabel className="px-2 text-[10px] tracking-wide text-muted-foreground uppercase">
              Cloud
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {cloud.map((p) => (
                <ProviderMenuItem key={p.id} provider={p} onAdd={onAdd} />
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
        <DropdownMenuLabel className="px-2 text-[10px] tracking-wide text-muted-foreground uppercase">
          Local & custom
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {local.map((p) => (
            <ProviderMenuItem key={p.id} provider={p} onAdd={onAdd} />
          ))}
          <DropdownMenuItem
            onSelect={() => onAddCompat()}
            className="flex items-center gap-2 text-[12px]"
          >
            <ProviderIcon provider="openai-compatible" size={13} />
            <span>OpenAI Compatible</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProviderMenuItem({
  provider,
  onAdd,
}: {
  provider: ProviderInfo;
  onAdd: (id: ProviderId) => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={() => onAdd(provider.id)}
      className="flex items-center gap-2 text-[12px]"
    >
      <ProviderIcon provider={provider.id} size={13} />
      <span>{provider.label}</span>
    </DropdownMenuItem>
  );
}

export function LocalProviderCard({
  provider,
  configured,
  config,
  meta,
  compatKey,
  onSaveKey,
  onClearKey,
  onRemove,
}: {
  provider: ProviderInfo;
  configured: boolean;
  config: LocalConfig;
  meta: LocalMeta;
  compatKey?: string | null;
  onSaveKey: (v: string) => Promise<void>;
  onClearKey: () => Promise<void> | void;
  onRemove: () => void;
}) {
  const {
    baseURL,
    modelId,
    setBaseURL,
    setModelId,
    contextLimit,
    setContextLimit,
    noBaseURL,
  } = config;
  const [urlDraft, setUrlDraft] = useSyncedDraft(baseURL);
  const [modelDraft, setModelDraft] = useSyncedDraft(modelId);
  const [contextDraft, setContextDraft] = useSyncedDraft(
    String(contextLimit ?? ""),
  );
  const [keyDraft, setKeyDraft] = useState("");
  const { testEndpoint, testStatus } = useProviderEndpointTest();

  const supportsKey =
    provider.id === "openai-compatible" || provider.id === "openrouter";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <ProviderIcon provider={provider.id} size={15} />
        <span className="text-[12.5px] font-medium">{provider.label}</span>
        {configured ? (
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
          className="ml-auto inline-flex min-h-7 items-center gap-0.5 rounded-md px-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
        >
          Docs
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            size={11}
            strokeWidth={1.75}
          />
        </button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Remove ${provider.label}`}
          onClick={onRemove}
          title="Remove provider"
          className="size-7 text-muted-foreground hover:text-destructive"
        >
          <HugeiconsIcon
            data-icon="inline-start"
            icon={Cancel01Icon}
            strokeWidth={1.75}
          />
        </Button>
      </div>

      <span className="text-[10.5px] leading-relaxed text-muted-foreground">
        {meta.description}
      </span>

      <div className="mt-0.5 flex flex-col gap-2.5">
        {noBaseURL ? null : (
          <FieldRow label="Base URL">
            {({ labelId }) => (
              <div className="flex flex-1 gap-1.5">
                <Input
                  type="url"
                  name={`${provider.id}-base-url`}
                  inputMode="url"
                  autoComplete="off"
                  aria-labelledby={labelId}
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  onBlur={() => {
                    const v = urlDraft.trim();
                    if (v !== baseURL) void setBaseURL(v);
                  }}
                  placeholder={meta.urlPlaceholder}
                  spellCheck={false}
                  className="h-8 flex-1 font-mono text-[11.5px]"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void testEndpoint(urlDraft)}
                  disabled={!urlDraft.trim()}
                  className="h-8 px-3 text-[11px]"
                >
                  Test
                </Button>
              </div>
            )}
          </FieldRow>
        )}

        <FieldRow label="Model ID">
          {({ labelId }) =>
            noBaseURL ? (
              <Input
                name={`${provider.id}-model-id`}
                autoComplete="off"
                aria-labelledby={labelId}
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                onBlur={() => {
                  const v = modelDraft.trim();
                  if (v !== modelId) void setModelId(v);
                }}
                placeholder={meta.modelPlaceholder}
                spellCheck={false}
                className="h-8 font-mono text-[11.5px]"
              />
            ) : (
              <ModelIdBrowseField
                name={`${provider.id}-model-id`}
                value={modelDraft}
                committedValue={modelId}
                onChange={setModelDraft}
                onCommit={setModelId}
                placeholder={meta.modelPlaceholder}
                baseURL={urlDraft}
                provider={provider.id}
                apiKey={compatKey ?? null}
                inputLabelledBy={labelId}
              />
            )
          }
        </FieldRow>

        {setContextLimit ? (
          <FieldRow label="Context">
            {({ labelId }) => (
              <div className="flex flex-1 items-center gap-1.5">
                <Input
                  type="number"
                  name={`${provider.id}-context-limit`}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-labelledby={labelId}
                  value={contextDraft}
                  onChange={(e) => setContextDraft(e.target.value)}
                  onBlur={() => {
                    const next = parseProviderContextLimitDraft(
                      contextDraft,
                      contextLimit,
                    );
                    if (next.ok) void setContextLimit(next.value);
                    else setContextDraft(next.resetValue);
                  }}
                  placeholder="128000"
                  spellCheck={false}
                  className="h-8 w-28 font-mono text-[11.5px]"
                />
                <span className="text-[10.5px] text-muted-foreground">
                  tokens
                </span>
              </div>
            )}
          </FieldRow>
        ) : null}

        {supportsKey ? (
          <FieldRow label="API key">
            {({ labelId }) =>
              compatKey ? (
                <div className="flex flex-1 items-center gap-1.5">
                  <code className="flex-1 truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                    {maskedProviderKey(compatKey)}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void onClearKey()}
                    title="Remove key"
                    aria-label="Remove API key"
                    className="size-7 text-muted-foreground hover:text-destructive"
                  >
                    <HugeiconsIcon
                      data-icon="inline-start"
                      icon={Cancel01Icon}
                      strokeWidth={1.75}
                    />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-1 gap-1.5">
                  <Input
                    type="password"
                    name={`${provider.id}-api-key`}
                    autoComplete="off"
                    aria-labelledby={labelId}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="Optional, leave empty for unauthenticated endpoints"
                    spellCheck={false}
                    className="h-8 flex-1 font-mono text-[11.5px]"
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
                      const v = keyDraft.trim();
                      if (!v) return;
                      await onSaveKey(v);
                      setKeyDraft("");
                    }}
                    disabled={!keyDraft.trim()}
                    className="h-8 px-3 text-[11px]"
                  >
                    Save
                  </Button>
                </div>
              )
            }
          </FieldRow>
        ) : null}

        <StatusLine status={testStatus} />

        {!modelId.trim() && meta.modelHint ? (
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            {meta.modelHint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CustomEndpointCard({
  endpoint,
  endpointKey,
  onSaveKey,
  onClearKey,
  onUpdate,
  onRemove,
}: {
  endpoint: CustomEndpoint;
  endpointKey: string | null;
  onSaveKey: (v: string) => Promise<void>;
  onClearKey: () => Promise<void> | void;
  onUpdate: (patch: Partial<CustomEndpoint>) => Promise<void>;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(!endpoint.baseURL.trim());
  const [nameDraft, setNameDraft] = useSyncedDraft(endpoint.name);
  const [urlDraft, setUrlDraft] = useSyncedDraft(endpoint.baseURL);
  const [modelDraft, setModelDraft] = useSyncedDraft(endpoint.modelId);
  const [contextDraft, setContextDraft] = useSyncedDraft(
    String(endpoint.contextLimit ?? ""),
  );
  const [keyDraft, setKeyDraft] = useState("");
  const { testEndpoint, testStatus } = useProviderEndpointTest();

  const configured = !!endpoint.baseURL.trim() && !!endpoint.modelId.trim();

  return (
    <div className="flex flex-col rounded-lg border border-border/60 bg-card/60">
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
        >
          <HugeiconsIcon
            icon={ChevronDown}
            size={12}
            strokeWidth={2}
            className={cn(
              "shrink-0 text-muted-foreground/60 transition-transform",
              !expanded && "-rotate-90",
            )}
          />
          <ProviderIcon provider="openai-compatible" size={15} />
          <span className="truncate text-[12.5px] font-medium">
            {endpoint.name || "OpenAI Compatible"}
          </span>
          {endpoint.modelId.trim() && (
            <span className="truncate font-mono text-[10.5px] text-muted-foreground">
              {endpoint.modelId}
            </span>
          )}
          {configured ? (
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
        </button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onRemove}
          title="Remove endpoint"
          aria-label={`Remove ${endpoint.name || "custom endpoint"}`}
          className="ml-auto size-7 text-muted-foreground hover:text-destructive"
        >
          <HugeiconsIcon
            data-icon="inline-start"
            icon={Cancel01Icon}
            strokeWidth={1.75}
          />
        </Button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-border/40 px-3 py-2.5">
          <FieldRow label="Name">
            {({ labelId }) => (
              <Input
                name={`custom-endpoint-${endpoint.id}-name`}
                autoComplete="off"
                aria-labelledby={labelId}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  const v = nameDraft.trim();
                  if (v !== endpoint.name) void onUpdate({ name: v });
                }}
                placeholder="My endpoint"
                spellCheck={false}
                className="h-8 flex-1 text-[11.5px]"
              />
            )}
          </FieldRow>

          <FieldRow label="Base URL">
            {({ labelId }) => (
              <div className="flex flex-1 gap-1.5">
                <Input
                  type="url"
                  name={`custom-endpoint-${endpoint.id}-base-url`}
                  inputMode="url"
                  autoComplete="off"
                  aria-labelledby={labelId}
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  onBlur={() => {
                    const v = urlDraft.trim();
                    if (v !== endpoint.baseURL) void onUpdate({ baseURL: v });
                  }}
                  placeholder="https://api.example.com/v1"
                  spellCheck={false}
                  className="h-8 flex-1 font-mono text-[11.5px]"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void testEndpoint(urlDraft)}
                  disabled={!urlDraft.trim()}
                  className="h-8 px-3 text-[11px]"
                >
                  Test
                </Button>
              </div>
            )}
          </FieldRow>

          <FieldRow label="Model ID">
            {({ labelId }) => (
              <ModelIdBrowseField
                name={`custom-endpoint-${endpoint.id}-model-id`}
                value={modelDraft}
                committedValue={endpoint.modelId}
                onChange={setModelDraft}
                onCommit={(modelId) => onUpdate({ modelId })}
                placeholder="gpt-4o, qwen3-max, glm-4.6, …"
                baseURL={urlDraft}
                provider="custom-endpoint"
                endpointId={endpoint.id}
                apiKey={endpointKey}
                inputLabelledBy={labelId}
              />
            )}
          </FieldRow>

          <FieldRow label="Context">
            {({ labelId }) => (
              <div className="flex flex-1 items-center gap-1.5">
                <Input
                  type="number"
                  name={`custom-endpoint-${endpoint.id}-context-limit`}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-labelledby={labelId}
                  value={contextDraft}
                  onChange={(e) => setContextDraft(e.target.value)}
                  onBlur={() => {
                    const next = parseProviderContextLimitDraft(
                      contextDraft,
                      endpoint.contextLimit,
                    );
                    if (next.ok) void onUpdate({ contextLimit: next.value });
                    else setContextDraft(next.resetValue);
                  }}
                  placeholder="128000"
                  spellCheck={false}
                  className="h-8 w-28 font-mono text-[11.5px]"
                />
                <span className="text-[10.5px] text-muted-foreground">
                  tokens
                </span>
              </div>
            )}
          </FieldRow>

          <FieldRow label="API key">
            {({ labelId }) =>
              endpointKey ? (
                <div className="flex flex-1 items-center gap-1.5">
                  <code className="flex-1 truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                    {maskedProviderKey(endpointKey)}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void onClearKey()}
                    title="Remove key"
                    aria-label={`Remove API key for ${endpoint.name || "custom endpoint"}`}
                    className="size-7 text-muted-foreground hover:text-destructive"
                  >
                    <HugeiconsIcon
                      data-icon="inline-start"
                      icon={Cancel01Icon}
                      strokeWidth={1.75}
                    />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-1 gap-1.5">
                  <Input
                    type="password"
                    name={`custom-endpoint-${endpoint.id}-api-key`}
                    autoComplete="off"
                    aria-labelledby={labelId}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="Optional, leave empty for unauthenticated endpoints"
                    spellCheck={false}
                    className="h-8 flex-1 font-mono text-[11.5px]"
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
                      const v = keyDraft.trim();
                      if (!v) return;
                      await onSaveKey(v);
                      setKeyDraft("");
                    }}
                    disabled={!keyDraft.trim()}
                    className="h-8 px-3 text-[11px]"
                  >
                    Save
                  </Button>
                </div>
              )
            }
          </FieldRow>

          <StatusLine status={testStatus} />
        </div>
      )}
    </div>
  );
}
