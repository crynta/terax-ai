import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  clearCopilotAuth,
  exchangeCopilotToken,
  fetchCopilotModels,
  isCopilotAuthenticated,
  persistCopilotAuth,
  pollAccessToken,
  startDeviceFlow,
  type CopilotModel,
} from "@/modules/ai/lib/copilot";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setDefaultModel } from "@/modules/settings/store";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  Link02Icon,
  Logout01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckmarkCircle02Icon, Copy01Icon } from "@hugeicons/core-free-icons";

type AuthPhase =
  | { phase: "idle" }
  | { phase: "waiting-code" }
  | {
      phase: "awaiting-auth";
      userCode: string;
      deviceCode: string;
      verificationUri: string;
    }
  | { phase: "connected" }
  | { phase: "error"; message: string };

type PollHandle = ReturnType<typeof setInterval>;

export function CopilotCard() {
  const [auth, setAuth] = useState<AuthPhase>({ phase: "idle" });
  const [models, setModels] = useState<CopilotModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const pollRef = useRef<PollHandle | null>(null);
  const defaultModel = usePreferencesStore((s) => s.defaultModelId);

  // Check auth state on mount.
  useEffect(() => {
    void checkAuth();
  }, []);

  const checkAuth = async () => {
    const authed = await isCopilotAuthenticated();
    if (authed) {
      setAuth({ phase: "connected" });
      void loadModels();
    }
  };

  const loadModels = async () => {
    setModelsLoading(true);
    try {
      const list = await fetchCopilotModels();
      setModels(list);
    } finally {
      setModelsLoading(false);
    }
  };

  const startAuth = async () => {
    setAuth({ phase: "waiting-code" });
    try {
      const flow = await startDeviceFlow();
      setAuth({
        phase: "awaiting-auth",
        userCode: flow.userCode,
        deviceCode: flow.deviceCode,
        verificationUri: flow.verificationUri,
      });

      // Open the GitHub device activation page.
      void openUrl(flow.verificationUri);

      // Poll for the user to complete auth.
      const interval = Math.max(flow.interval, 5);
      pollRef.current = setInterval(async () => {
        try {
          const ghoToken = await pollAccessToken(flow.deviceCode);
          if (ghoToken === null) return; // still pending

          // User authorized! Exchange gho_token for copilot_token.
          clearInterval(pollRef.current!);
          pollRef.current = null;

          const info = await exchangeCopilotToken(ghoToken);
          await persistCopilotAuth(ghoToken, info.token, info.expiresAt);
          setAuth({ phase: "connected" });
          void loadModels();
        } catch (err) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setAuth({
            phase: "error",
            message: err instanceof Error ? err.message : "Auth failed",
          });
        }
      }, interval * 1000);
    } catch (err) {
      setAuth({
        phase: "error",
        message: err instanceof Error ? err.message : "Failed to start auth",
      });
    }
  };

  const signOut = async () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    await clearCopilotAuth();
    setAuth({ phase: "idle" });
    setModels([]);
  };

  const retry = () => {
    setAuth({ phase: "idle" });
  };

  const [copied, setCopied] = useState(false);

  const copyCode = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the code text
    }
  }, []);

  // Auto-copy code when it appears.
  useEffect(() => {
    if (auth.phase === "awaiting-auth") {
      void copyCode(auth.userCode);
    }
  }, [auth.phase]);

  // Cleanup poll on unmount.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const authedModelId = defaultModel.startsWith("github-copilot/")
    ? defaultModel.slice("github-copilot/".length)
    : null;

  const selectModel = useCallback((modelId: string) => {
    void setDefaultModel(
      `github-copilot/${modelId}` as import("@/modules/ai/config").ModelId,
    );
  }, []);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex size-4 items-center justify-center">
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className="size-4 text-foreground"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8" />
          </svg>
        </div>
        <span className="text-[12.5px] font-medium">GitHub Copilot</span>
        {auth.phase === "connected" ? (
          <Badge
            variant="outline"
            className="ml-1 h-4 gap-1 border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-300"
          >
            <svg
              viewBox="0 0 12 12"
              fill="currentColor"
              className="size-2.5"
            >
              <circle cx="6" cy="6" r="5" />
            </svg>
            Connected
          </Badge>
        ) : null}
      </div>

      {/* Connected state */}
      {auth.phase === "connected" ? (
        <div className="flex flex-col gap-2">
          {/* Model selector */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
              Model
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-8 justify-between gap-2 px-2.5 text-[11.5px]"
                >
                  <span className="truncate font-mono">
                    {authedModelId ?? "Select a model"}
                  </span>
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={12}
                    strokeWidth={2}
                    className="shrink-0 opacity-70"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-64 min-w-[200px] overflow-y-auto">
                {modelsLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
                    <Spinner className="size-3" />
                    Loading models…
                  </div>
                ) : models.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground">
                    No models found
                  </div>
                ) : (
                  models.map((m) => (
                    <DropdownMenuItem
                      key={m.id}
                      onSelect={() => selectModel(m.id)}
                      className={cn(
                        "gap-2 font-mono text-[11.5px]",
                        m.id === authedModelId && "bg-accent/50",
                      )}
                    >
                      <span className="truncate">{m.name ?? m.id}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Actions row */}
          <div className="flex items-center justify-between">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadModels()}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              <HugeiconsIcon icon={RefreshIcon} size={11} strokeWidth={1.75} />
              Refresh models
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void signOut()}
              className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-destructive"
            >
              <HugeiconsIcon
                icon={Logout01Icon}
                size={11}
                strokeWidth={1.75}
              />
              Sign out
            </Button>
          </div>
        </div>
      ) : null}

      {/* Idle state — show sign-in */}
      {auth.phase === "idle" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void startAuth()}
          className="h-7 gap-1 self-start px-2.5 text-[11px]"
        >
          <HugeiconsIcon icon={Link02Icon} size={11} strokeWidth={1.75} />
          Sign in with GitHub
        </Button>
      ) : null}

      {/* Waiting for device code */}
      {auth.phase === "waiting-code" ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Spinner className="size-3" />
          Starting GitHub OAuth…
        </div>
      ) : null}

      {/* Awaiting user auth — show code */}
      {auth.phase === "awaiting-auth" ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Enter the code below on the GitHub page that opened in your browser.
          </p>
          <div className="flex items-center gap-2">
            <code className="inline-block rounded-md border border-border bg-muted/40 px-3 py-1.5 font-mono text-[18px] font-bold tracking-[0.25em]">
              {auth.userCode}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copyCode(auth.userCode)}
              className="h-7 gap-1 px-2 text-[11px]"
              title="Copy code"
            >
              <HugeiconsIcon
                icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
                size={11}
                strokeWidth={1.75}
              />
              {copied ? "Copied!" : "Copy"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void openUrl(auth.verificationUri)}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              <HugeiconsIcon
                icon={Link02Icon}
                size={11}
                strokeWidth={1.75}
              />
              Open page
            </Button>
          </div>
          <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
            <Spinner className="size-2.5" />
            Waiting for authorization…
            <button
              type="button"
              onClick={() => void signOut()}
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Error state */}
      {auth.phase === "error" ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10.5px] text-destructive">{auth.message}</p>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={retry}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                size={11}
                strokeWidth={1.75}
              />
              Retry
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void signOut()}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              <HugeiconsIcon
                icon={Cancel01Icon}
                size={11}
                strokeWidth={1.75}
              />
              Clear
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
