import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WebhookRoute, WebhookPayload } from "../lib/nativeTriggers";
import {
  webhookListRoutes,
  webhookRegister,
  webhookStartServer,
  webhookStopServer,
  webhookUnregister,
  listenWebhook,
} from "../lib/nativeTriggers";

/**
 * Panel for managing webhook HTTP routes.
 * Shown when the webhook trigger node is selected.
 */
export function WebhookPanel({ visible }: { visible: boolean }) {
  const [routes, setRoutes] = useState<WebhookRoute[]>([]);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [newPath, setNewPath] = useState("/webhook");
  const [newMethod, setNewMethod] = useState("POST");
  const [recentPayloads, setRecentPayloads] = useState<WebhookPayload[]>([]);

  useEffect(() => {
    if (!visible) return;
    webhookListRoutes()
      .then(setRoutes)
      .catch(() => {});

    const unlisten = listenWebhook((payload) => {
      setRecentPayloads((prev) => [payload, ...prev.slice(0, 9)]);
    }).catch(() => () => {});

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [visible]);

  const handleStartServer = useCallback(async () => {
    try {
      const url = await webhookStartServer(3456);
      setServerUrl(url);
    } catch {
      // May not be running in Tauri — graceful fallback
    }
  }, []);

  const handleStopServer = useCallback(async () => {
    try {
      await webhookStopServer();
      setServerUrl(null);
    } catch {
      // Ignore
    }
  }, []);

  const handleAddRoute = useCallback(async () => {
    try {
      const route = await webhookRegister(newPath, newMethod);
      setRoutes((prev) => [...prev, route]);
      setNewPath("/webhook");
    } catch {
      // May not be running in Tauri
    }
  }, [newPath, newMethod]);

  const handleRemoveRoute = useCallback(async (id: string) => {
    try {
      await webhookUnregister(id);
      setRoutes((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // Ignore
    }
  }, []);

  if (!visible) return null;

  return (
    <div className="flex flex-col gap-3 p-3">
      <h3 className="font-medium text-sm">Webhook Server</h3>

      {/* Server controls */}
      <div className="flex items-center gap-2">
        {serverUrl ? (
          <>
            <Badge variant="default" className="text-[10px]">
              {serverUrl}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px]"
              onClick={handleStopServer}
            >
              Stop
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px]"
            onClick={handleStartServer}
          >
            Start Server :3456
          </Button>
        )}
      </div>

      {/* Add route */}
      <div className="flex items-center gap-2">
        <select
          className="h-7 rounded border border-border bg-background px-2 text-xs"
          value={newMethod}
          onChange={(e) => setNewMethod(e.target.value)}
        >
          <option>GET</option>
          <option>POST</option>
          <option>PUT</option>
          <option>DELETE</option>
        </select>
        <input
          type="text"
          className="h-7 flex-1 rounded border border-border bg-background px-2 text-xs"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          placeholder="/path"
        />
        <Button
          size="sm"
          variant="default"
          className="h-7 text-[10px]"
          onClick={handleAddRoute}
        >
          Add
        </Button>
      </div>

      {/* Route list */}
      {routes.length > 0 ? (
        <div className="flex flex-col gap-1">
          {routes.map((route) => (
            <div
              key={route.id}
              className="flex items-center justify-between rounded border border-border/40 bg-muted/20 px-2 py-1"
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px]">
                  {route.method}
                </Badge>
                <span className="font-mono text-[10px]">{route.path}</span>
                {route.auth_token && (
                  <Badge variant="secondary" className="text-[9px]">
                    Auth
                  </Badge>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 w-5 p-0 text-[10px] text-muted-foreground"
                onClick={() => handleRemoveRoute(route.id)}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground text-[10px] italic">
          No routes registered
        </div>
      )}

      {/* Recent payloads */}
      {recentPayloads.length > 0 && (
        <div>
          <h4 className="mb-1 text-muted-foreground text-[10px] uppercase tracking-wider">
            Recent Requests
          </h4>
          <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
            {recentPayloads.map((p, i) => (
              <div
                key={i}
                className="rounded border border-border/40 bg-muted/10 px-2 py-1"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[9px]">
                    {p.method}
                  </Badge>
                  <span className="font-mono text-[10px]">{p.path}</span>
                  <span className="text-muted-foreground text-[9px]">
                    {p.received_at.slice(11, 19)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
