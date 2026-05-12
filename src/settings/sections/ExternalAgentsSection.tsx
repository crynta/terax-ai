import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  clearAuthEnvValue,
  readAuthEnvValue,
  testBackend,
  useBackendsStore,
  writeAuthEnvValue,
  type AuthEnvDescriptor,
  type TestResult,
} from "@/modules/ai/agents-acp";
import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  CopyIcon,
  PlayIcon,
  PlusSignIcon,
  Refresh01Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: TestResult };

export function ExternalAgentsSection() {
  const { backends, hydrated, hydrating, error, refresh } = useBackendsStore();
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  useEffect(() => {
    if (!hydrated) void refresh();
  }, [hydrated, refresh]);

  const installedCount = backends.filter((b) => b.binaryPath).length;

  const onTest = async (backendId: string, withPrompt: boolean) => {
    setTestStates((s) => ({ ...s, [backendId]: { kind: "running" } }));
    try {
      const result = await testBackend(backendId, null, withPrompt);
      setTestStates((s) => ({ ...s, [backendId]: { kind: "done", result } }));
    } catch (e) {
      // The Tauri command itself failed (rare — usually means the
      // command wasn't registered or state is missing). Build a fake
      // failure result so the UI surface is uniform.
      setTestStates((s) => ({
        ...s,
        [backendId]: {
          kind: "done",
          result: {
            ok: false,
            backendId,
            binaryPath: null,
            agentName: null,
            agentVersion: null,
            protocolVersion: null,
            sessionId: null,
            authMethods: [],
            strippedEnv: [],
            forwardedAuth: [],
            proxies: [],
            prompt: null,
            error: e instanceof Error ? e.message : String(e),
            stderr: null,
            elapsedMs: 0,
          },
        },
      }));
    }
  };

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="External Agents"
        description="Drive Claude Code, Codex, or Gemini directly from Terax via the Agent Client Protocol. The agent runs on your machine; auth is handled by each CLI."
      />

      <div className="flex items-center justify-between">
        <div className="text-[12px] text-muted-foreground">
          {hydrated
            ? `${installedCount} of ${backends.length} agents detected on $PATH`
            : hydrating
              ? "Detecting installed agents…"
              : "Not yet detected"}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={hydrating}
          className="h-7 gap-1.5"
        >
          <HugeiconsIcon icon={Refresh01Icon} size={13} strokeWidth={2} />
          Recheck
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[12px] text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {backends.map((b) => {
          const state = testStates[b.id] ?? { kind: "idle" };
          return (
            <div
              key={b.id}
              className="flex flex-col gap-2 rounded-md border border-border/60 bg-card/50 p-4"
            >
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-medium">{b.label}</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {b.kind}
                </Badge>
                {b.binaryPath ? (
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                    <HugeiconsIcon
                      icon={CheckmarkCircle02Icon}
                      size={12}
                      strokeWidth={2}
                    />
                    Installed
                  </span>
                ) : (
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      size={12}
                      strokeWidth={2}
                    />
                    Not installed
                  </span>
                )}
              </div>

              {b.binaryPath ? (
                <div className="font-mono text-[10.5px] text-muted-foreground">
                  {b.binaryPath}
                </div>
              ) : (
                <InstallHint command={b.installHint} />
              )}

              <p className="text-[12px] text-muted-foreground">{b.authHint}</p>

              {b.authEnvs.length > 0 ? (
                <div className="flex flex-col gap-2 pt-1">
                  {b.authEnvs.map((env) => (
                    <AuthEnvField key={env.account} env={env} />
                  ))}
                </div>
              ) : null}

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!b.binaryPath || state.kind === "running"}
                  onClick={() => void onTest(b.id, false)}
                  className="h-7 gap-1.5"
                >
                  <HugeiconsIcon
                    icon={state.kind === "running" ? Loading03Icon : PlayIcon}
                    size={12}
                    strokeWidth={2}
                    className={state.kind === "running" ? "animate-spin" : ""}
                  />
                  {state.kind === "running" ? "Testing…" : "Test connection"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!b.binaryPath || state.kind === "running"}
                  onClick={() => void onTest(b.id, true)}
                  className="h-7 text-[11px] text-muted-foreground"
                  title="Includes a real prompt — costs one cheap API turn but exercises the full chat path (auth, proxy, network)."
                >
                  Deep test
                </Button>
                <button
                  type="button"
                  onClick={() => void openUrl(b.docsUrl)}
                  className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Documentation
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={11}
                    strokeWidth={2}
                  />
                </button>
              </div>

              {state.kind === "done" ? (
                <ProbeReport result={state.result} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Inline editor for a single auth-env entry (API key or OAuth token).
 *
 * Reads the existing keychain value once on mount, shows it as masked.
 * Edits go to a local draft until the user explicitly saves — the keychain
 * write is then immediate (no separate Save All button). Clearing the
 * field deletes the keychain entry.
 */
function AuthEnvField({ env }: { env: AuthEnvDescriptor }) {
  const [value, setValue] = useState<string>("");
  const [stored, setStored] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    void readAuthEnvValue(env.account).then((v) => {
      if (v != null) {
        setStored(true);
        setValue("");
      }
    });
  }, [env.account]);

  const masked = stored && !editing;

  const onSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await writeAuthEnvValue(env.account, value);
      setStored(true);
      setEditing(false);
      setValue("");
    } finally {
      setSaving(false);
    }
  };

  const onClear = async () => {
    setSaving(true);
    try {
      await clearAuthEnvValue(env.account);
      setStored(false);
      setEditing(false);
      setValue("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[11.5px] font-medium">{env.label}</span>
        <span className="font-mono text-[9.5px] text-muted-foreground">
          → {env.envName}
        </span>
        {stored && !editing ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Saved
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="password"
          autoComplete="off"
          placeholder={masked ? "•••••••• (stored in keychain)" : env.hint}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setEditing(true);
          }}
          onFocus={() => setEditing(true)}
          className="h-7 font-mono text-[11px]"
          disabled={saving}
        />
        {editing && value.trim().length > 0 ? (
          <Button
            size="sm"
            variant="default"
            onClick={() => void onSave()}
            disabled={saving}
            className="h-7 text-[11px]"
          >
            Save
          </Button>
        ) : null}
        {stored ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void onClear()}
            disabled={saving}
            className="h-7 text-[11px] text-muted-foreground"
            title="Remove this credential from the keychain"
          >
            Clear
          </Button>
        ) : null}
      </div>
      <p className="text-[10.5px] text-muted-foreground">{env.hint}</p>
    </div>
  );
}

function InstallHint({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-border/40 bg-muted/30 px-2 py-1 font-mono text-[11px] text-muted-foreground">
      <span className="truncate">{command}</span>
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(command)}
        className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted/60"
        title="Copy install command"
      >
        <HugeiconsIcon icon={CopyIcon} size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

function ProbeReport({ result }: { result: TestResult }) {
  return (
    <div
      className={
        result.ok
          ? "mt-1 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11px]"
          : "mt-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-[11px]"
      }
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span
          className={
            result.ok
              ? "size-1.5 rounded-full bg-emerald-500"
              : "size-1.5 rounded-full bg-amber-500"
          }
        />
        <span className="font-medium">
          {result.ok ? "Connection OK" : "Connection failed"}
        </span>
        <span className="ml-auto text-muted-foreground tabular-nums">
          {result.elapsedMs}ms
        </span>
      </div>

      {result.ok ? (
        <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
          {result.agentName ? (
            <>
              <span>Agent</span>
              <span className="font-mono text-foreground">
                {result.agentName}
                {result.agentVersion ? ` ${result.agentVersion}` : ""}
              </span>
            </>
          ) : null}
          {result.protocolVersion != null ? (
            <>
              <span>ACP version</span>
              <span className="font-mono text-foreground">
                v{result.protocolVersion}
              </span>
            </>
          ) : null}
          {result.sessionId ? (
            <>
              <span>Session id</span>
              <span className="font-mono text-foreground truncate">
                {result.sessionId}
              </span>
            </>
          ) : null}
          {result.authMethods.length > 0 ? (
            <>
              <span>Auth needed</span>
              <span className="font-mono text-amber-600 dark:text-amber-400">
                {result.authMethods.join(", ")}
              </span>
            </>
          ) : null}
          <span>Auth source</span>
          <span className="font-mono text-foreground">
            {result.forwardedAuth.length > 0
              ? result.forwardedAuth.join(", ")
              : "CLI's own credentials"}
          </span>
          {result.prompt ? (
            <>
              <span>Prompt round-trip</span>
              <span
                className={
                  result.prompt.ok
                    ? "font-mono text-emerald-600 dark:text-emerald-400"
                    : "font-mono text-amber-600 dark:text-amber-400"
                }
              >
                {result.prompt.ok
                  ? `OK (stop: ${result.prompt.stopReason ?? "?"})`
                  : (result.prompt.error ?? "failed")}
              </span>
            </>
          ) : null}
          {result.proxies.length > 0 ? (
            <>
              <span>Proxy</span>
              <span className="font-mono text-foreground">
                {result.proxies
                  .map(
                    (p) =>
                      `${p.var}=${p.value} ${p.reachable === true ? "✓" : p.reachable === false ? "✗" : "?"}`,
                  )
                  .join(" · ")}
              </span>
            </>
          ) : null}
          {result.strippedEnv.length > 0 ? (
            <>
              <span>Stripped env</span>
              <span className="font-mono text-foreground">
                {result.strippedEnv.join(", ")}
              </span>
            </>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {result.error ? (
            <div className="font-mono text-foreground">{result.error}</div>
          ) : null}
          {result.prompt && !result.prompt.ok ? (
            <div className="font-mono text-foreground">
              Prompt failed: {result.prompt.error ?? "unknown"}
            </div>
          ) : null}
          {result.proxies.some((p) => p.reachable === false) ? (
            <div className="rounded-sm border border-amber-500/40 bg-amber-500/5 p-1.5 text-amber-700 dark:text-amber-300">
              <strong>Proxy unreachable.</strong>{" "}
              {result.proxies
                .filter((p) => p.reachable === false)
                .map((p) => `${p.var}=${p.value}`)
                .join(", ")}
              . Either start the proxy, unset the env var in your shell,
              or relaunch Terax from a shell without it. This is the
              most common cause of <code>ECONNREFUSED</code> at chat time.
            </div>
          ) : null}
          {result.proxies.length > 0 &&
          result.proxies.every((p) => p.reachable !== false) ? (
            <div className="text-muted-foreground">
              Proxies (all reachable):{" "}
              <span className="font-mono">
                {result.proxies
                  .map((p) => `${p.var}=${p.value}`)
                  .join(", ")}
              </span>
            </div>
          ) : null}
          {result.binaryPath ? (
            <div className="text-muted-foreground">
              Binary:{" "}
              <span className="font-mono">{result.binaryPath}</span>
            </div>
          ) : null}
          {result.strippedEnv.length > 0 ? (
            <div className="text-muted-foreground">
              Stripped env:{" "}
              <span className="font-mono">
                {result.strippedEnv.join(", ")}
              </span>
            </div>
          ) : null}
          {result.stderr ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-muted-foreground">
                Agent stderr ({result.stderr.length} chars)
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded-sm bg-muted/40 p-2 font-mono text-[10.5px] whitespace-pre-wrap">
                {result.stderr}
              </pre>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}
