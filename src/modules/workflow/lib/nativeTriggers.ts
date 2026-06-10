import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Frontend bindings for the Tauri webhook HTTP server.
 */

export interface WebhookRoute {
  id: string;
  path: string;
  method: string;
  auth_token: string | null;
}

export interface WebhookPayload {
  route_id: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  body_json: unknown;
  received_at: string;
}

export async function webhookRegister(
  path: string,
  method: string,
  authToken?: string,
): Promise<WebhookRoute> {
  return invoke("webhook_register", { path, method, authToken: authToken ?? null });
}

export async function webhookUnregister(routeId: string): Promise<void> {
  return invoke("webhook_unregister", { routeId });
}

export async function webhookStartServer(port: number): Promise<string> {
  return invoke("webhook_start_server", { port });
}

export async function webhookStopServer(): Promise<void> {
  return invoke("webhook_stop_server");
}

export async function webhookListRoutes(): Promise<WebhookRoute[]> {
  return invoke("webhook_list_routes");
}

export function listenWebhook(
  callback: (payload: WebhookPayload) => void,
): Promise<UnlistenFn> {
  return listen<WebhookPayload>("workflow:webhook", (event) => {
    callback(event.payload);
  });
}

/**
 * Frontend bindings for the Tauri schedule cron daemon.
 */

export interface ScheduleJob {
  id: string;
  name: string;
  cron_expression: string;
  enabled: boolean;
}

export interface ScheduleTrigger {
  job_id: string;
  name: string;
  fired_at: string;
}

export async function scheduleAddJob(
  name: string,
  cronExpression: string,
): Promise<ScheduleJob> {
  return invoke("schedule_add_job", { name, cronExpression });
}

export async function scheduleRemoveJob(jobId: string): Promise<void> {
  return invoke("schedule_remove_job", { jobId });
}

export async function scheduleToggleJob(
  jobId: string,
  enabled: boolean,
): Promise<void> {
  return invoke("schedule_toggle_job", { jobId, enabled });
}

export async function scheduleListJobs(): Promise<ScheduleJob[]> {
  return invoke("schedule_list_jobs");
}

export async function scheduleStartDaemon(): Promise<void> {
  return invoke("schedule_start_daemon");
}

export async function scheduleStopDaemon(): Promise<void> {
  return invoke("schedule_stop_daemon");
}

export function listenSchedule(
  callback: (trigger: ScheduleTrigger) => void,
): Promise<UnlistenFn> {
  return listen<ScheduleTrigger>("workflow:schedule", (event) => {
    callback(event.payload);
  });
}
