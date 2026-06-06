import { openUrl } from "@tauri-apps/plugin-opener";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { formatPiErrorDetail } from "@/modules/pi/lib/errors";
import { piNative } from "@/modules/pi/lib/native";
import type {
  McpEnvSecretStatus,
  McpOAuthStartResult,
  McpServerConfig,
  McpServerStatus,
  McpStoredServerConfig,
  McpToolDescriptor,
} from "@/modules/pi/lib/native";
import { usePiControllerState } from "@/modules/pi/lib/PiControllerProvider";

const EMPTY_MCP_CONFIGS: McpStoredServerConfig[] = [];
const EMPTY_MCP_ENV_SECRET_STATUSES: McpEnvSecretStatus[] = [];
const EMPTY_MCP_STATUSES: McpServerStatus[] = [];
const EMPTY_MCP_TOOLS: McpToolDescriptor[] = [];

export type McpOAuthDialogState = {
  server: McpStoredServerConfig;
  start: McpOAuthStartResult;
  codeOrRedirectUrl: string;
  error: string | null;
  isCompleting: boolean;
  isWaitingForCallback: boolean;
};

type UseMcpSurfaceOptions = {
  refreshDiagnostics: () => Promise<void>;
};

function errorMessage(error: unknown): string {
  return formatPiErrorDetail(error);
}

export function useMcpSurface({ refreshDiagnostics }: UseMcpSurfaceOptions) {
  const [configs, setConfigs] = usePiControllerState(
    "mcpConfigs",
    EMPTY_MCP_CONFIGS,
  );
  const [envSecretStatuses, setEnvSecretStatuses] = usePiControllerState(
    "mcpEnvSecretStatuses",
    EMPTY_MCP_ENV_SECRET_STATUSES,
  );
  const [statuses, setStatuses] = usePiControllerState(
    "mcpStatuses",
    EMPTY_MCP_STATUSES,
  );
  const [tools, setTools] = usePiControllerState("mcpTools", EMPTY_MCP_TOOLS);
  const [error, setError] = usePiControllerState("mcpError", null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const [oauthDialog, setOAuthDialog] = useState<McpOAuthDialogState | null>(
    null,
  );
  const oauthDialogRef = useRef<McpOAuthDialogState | null>(null);
  const busyServerIdRef = useRef<string | null>(null);

  useEffect(() => {
    oauthDialogRef.current = oauthDialog;
  }, [oauthDialog]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [nextConfigs, nextTools, nextStatuses] = await Promise.all([
        piNative.mcpServerConfigsList(),
        piNative.mcpTools(),
        piNative.mcpServerStatuses(),
      ]);
      const nextEnvSecretStatuses = (
        await Promise.all(
          nextConfigs.map((config) => {
            const names = config.env.map((item) => item.name);
            return names.length > 0
              ? piNative.mcpEnvSecretStatuses(config.id, names)
              : Promise.resolve([]);
          }),
        )
      ).flat();
      setConfigs(nextConfigs);
      setEnvSecretStatuses(nextEnvSecretStatuses);
      setTools(nextTools);
      setStatuses(nextStatuses);
      setError(null);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const beginBusy = useCallback((operationId: string) => {
    if (busyServerIdRef.current !== null) return false;
    busyServerIdRef.current = operationId;
    setBusyServerId(operationId);
    return true;
  }, []);

  const clearBusy = useCallback(() => {
    busyServerIdRef.current = null;
    setBusyServerId(null);
  }, []);

  const connect = useCallback(
    async (server: McpStoredServerConfig) => {
      if (!beginBusy(server.id)) return;
      setError(null);
      try {
        await piNative.mcpConnectSavedStdio(server.id);
        await refresh();
        await refreshDiagnostics();
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        clearBusy();
      }
    },
    [beginBusy, clearBusy, refresh, refreshDiagnostics, setError],
  );

  const disconnect = useCallback(
    async (serverId: string) => {
      if (!beginBusy(serverId)) return;
      setError(null);
      try {
        await piNative.mcpDisconnect(serverId);
        await refresh();
        await refreshDiagnostics();
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        clearBusy();
      }
    },
    [beginBusy, clearBusy, refresh, refreshDiagnostics, setError],
  );

  const restart = useCallback(
    async (server: McpStoredServerConfig) => {
      if (!beginBusy(server.id)) return;
      setError(null);
      try {
        await piNative.mcpDisconnect(server.id);
        await piNative.mcpConnectSavedStdio(server.id);
        await refresh();
        await refreshDiagnostics();
      } catch (nextError) {
        setError(errorMessage(nextError));
        await refresh();
      } finally {
        clearBusy();
      }
    },
    [beginBusy, clearBusy, refresh, refreshDiagnostics, setError],
  );

  const saveConfig = useCallback(
    async (config: McpServerConfig) => {
      if (!beginBusy(config.id)) return;
      setError(null);
      try {
        await piNative.mcpServerConfigSave(config);
        await refresh();
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        clearBusy();
      }
    },
    [beginBusy, clearBusy, refresh, setError],
  );

  const completeOAuth = useCallback(
    async (dialog: McpOAuthDialogState, codeOrRedirectUrl: string) => {
      setOAuthDialog({
        ...dialog,
        codeOrRedirectUrl,
        error: null,
        isCompleting: true,
        isWaitingForCallback: false,
      });
      try {
        await piNative.mcpOAuthComplete({
          serverId: dialog.server.id,
          codeOrRedirectUrl,
          state: dialog.start.state,
          codeVerifier: dialog.start.codeVerifier,
          redirectUri: dialog.start.redirectUri,
          clientId: dialog.start.clientId,
          tokenEnv: dialog.start.tokenEnv,
        });
        setOAuthDialog(null);
        await refresh();
        await refreshDiagnostics();
        clearBusy();
      } catch (nextError) {
        const message = errorMessage(nextError);
        setError(message);
        setOAuthDialog((current) =>
          current?.start.state === dialog.start.state
            ? { ...current, error: message, isCompleting: false }
            : current,
        );
        await refresh();
      }
    },
    [clearBusy, refresh, refreshDiagnostics, setError],
  );

  const startOAuth = useCallback(
    async (server: McpStoredServerConfig) => {
      if (!beginBusy(server.id)) return;
      setError(null);
      try {
        const start = await piNative.mcpOAuthStart({ serverId: server.id });
        const callbackPromise = piNative.mcpOAuthWaitForCallback({
          state: start.state,
          redirectUri: start.redirectUri,
          timeoutMs: 120_000,
        });
        void callbackPromise.catch(() => undefined);
        const dialog: McpOAuthDialogState = {
          server,
          start,
          codeOrRedirectUrl: "",
          error: null,
          isCompleting: false,
          isWaitingForCallback: true,
        };
        oauthDialogRef.current = dialog;
        setOAuthDialog(dialog);
        await openUrl(start.authorizationUrl);
        try {
          const callback = await callbackPromise;
          const current = oauthDialogRef.current;
          if (current?.start.state !== start.state || current.isCompleting) {
            return;
          }
          await completeOAuth(current, callback.codeOrRedirectUrl);
        } catch (nextError) {
          const current = oauthDialogRef.current;
          if (current?.start.state !== start.state) return;
          setOAuthDialog({
            ...current,
            error: `Automatic callback failed: ${errorMessage(nextError)}. Paste the redirect URL or code to continue.`,
            isWaitingForCallback: false,
          });
        }
      } catch (nextError) {
        setError(errorMessage(nextError));
        await refresh();
        clearBusy();
      }
    },
    [beginBusy, clearBusy, completeOAuth, refresh, setError],
  );

  const cancelOAuthDialog = useCallback(() => {
    setOAuthDialog(null);
    clearBusy();
  }, [clearBusy]);

  const setOAuthCodeOrRedirectUrl = useCallback((codeOrRedirectUrl: string) => {
    setOAuthDialog((current) =>
      current ? { ...current, codeOrRedirectUrl, error: null } : current,
    );
  }, []);

  const reopenOAuthAuthorization = useCallback(async () => {
    const authorizationUrl = oauthDialogRef.current?.start.authorizationUrl;
    if (authorizationUrl) await openUrl(authorizationUrl);
  }, []);

  const submitOAuthDialog = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const dialog = oauthDialog;
      const codeOrRedirectUrl = dialog?.codeOrRedirectUrl.trim();
      if (!dialog || !codeOrRedirectUrl || dialog.isCompleting) return;
      await completeOAuth(dialog, codeOrRedirectUrl);
    },
    [completeOAuth, oauthDialog],
  );

  const removeConfig = useCallback(
    async (serverId: string) => {
      const confirmed =
        typeof window === "undefined" ||
        window.confirm(
          "Remove this saved MCP server config? Connected servers keep running until disconnected.",
        );
      if (!confirmed || !beginBusy(serverId)) return;

      setError(null);
      try {
        await piNative.mcpServerConfigRemove(serverId);
        await refresh();
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        clearBusy();
      }
    },
    [beginBusy, clearBusy, refresh, setError],
  );

  const setEnvSecret = useCallback(
    async (serverId: string, name: string, value: string) => {
      if (!beginBusy(`${serverId}:${name}`)) return;
      setError(null);
      try {
        await piNative.mcpEnvSecretSet(serverId, name, value);
        await refresh();
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        clearBusy();
      }
    },
    [beginBusy, clearBusy, refresh, setError],
  );

  const removeEnvSecret = useCallback(
    async (serverId: string, name: string) => {
      if (!beginBusy(`${serverId}:${name}`)) return;
      setError(null);
      try {
        await piNative.mcpEnvSecretRemove(serverId, name);
        await refresh();
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        clearBusy();
      }
    },
    [beginBusy, clearBusy, refresh, setError],
  );

  const setToolPolicy = useCallback(
    async (qualifiedName: string, approvalPolicy: "auto" | "ask" | "deny") => {
      if (!beginBusy(qualifiedName)) return;
      setError(null);
      try {
        await piNative.mcpToolPolicySet(qualifiedName, approvalPolicy);
        await refresh();
        await refreshDiagnostics();
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        clearBusy();
      }
    },
    [beginBusy, clearBusy, refresh, refreshDiagnostics, setError],
  );

  return {
    busyServerId,
    cancelOAuthDialog,
    configs,
    connect,
    disconnect,
    envSecretStatuses,
    error,
    isRefreshing,
    oauthDialog,
    refresh,
    removeConfig,
    removeEnvSecret,
    reopenOAuthAuthorization,
    restart,
    saveConfig,
    setEnvSecret,
    setOAuthCodeOrRedirectUrl,
    setToolPolicy,
    startOAuth,
    statuses,
    submitOAuthDialog,
    tools,
  };
}
