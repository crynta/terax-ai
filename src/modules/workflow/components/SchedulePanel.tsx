import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ScheduleJob, ScheduleTrigger } from "../lib/nativeTriggers";
import {
  scheduleAddJob,
  scheduleListJobs,
  scheduleRemoveJob,
  scheduleStartDaemon,
  scheduleStopDaemon,
  scheduleToggleJob,
  listenSchedule,
} from "../lib/nativeTriggers";

/**
 * Panel for managing scheduled cron jobs.
 * Shown when the schedule trigger node is selected.
 */
export function SchedulePanel({ visible }: { visible: boolean }) {
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [daemonRunning, setDaemonRunning] = useState(false);
  const [newName, setNewName] = useState("Daily check");
  const [newCron, setNewCron] = useState("0 9 * * *");
  const [recentTriggers, setRecentTriggers] = useState<ScheduleTrigger[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    scheduleListJobs()
      .then(setJobs)
      .catch(() => {});

    const unlisten = listenSchedule((trigger) => {
      setRecentTriggers((prev) => [trigger, ...prev.slice(0, 9)]);
    }).catch(() => () => {});

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [visible]);

  const handleStartDaemon = useCallback(async () => {
    try {
      await scheduleStartDaemon();
      setDaemonRunning(true);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const handleStopDaemon = useCallback(async () => {
    try {
      await scheduleStopDaemon();
      setDaemonRunning(false);
    } catch {
      // Ignore
    }
  }, []);

  const handleAddJob = useCallback(async () => {
    try {
      const job = await scheduleAddJob(newName, newCron);
      setJobs((prev) => [...prev, job]);
      setNewName("Daily check");
      setNewCron("0 9 * * *");
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [newName, newCron]);

  const handleRemoveJob = useCallback(async (id: string) => {
    try {
      await scheduleRemoveJob(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } catch {
      // Ignore
    }
  }, []);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    try {
      await scheduleToggleJob(id, enabled);
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, enabled } : j)));
    } catch {
      // Ignore
    }
  }, []);

  if (!visible) return null;

  return (
    <div className="flex flex-col gap-3 p-3">
      <h3 className="font-medium text-sm">Schedule Daemon</h3>

      {/* Daemon controls */}
      <div className="flex items-center gap-2">
        {daemonRunning ? (
          <>
            <Badge variant="default" className="text-[10px]">
              ● Running
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px]"
              onClick={handleStopDaemon}
            >
              Stop Daemon
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px]"
            onClick={handleStartDaemon}
          >
            Start Daemon
          </Button>
        )}
      </div>

      {/* Add job */}
      <div className="flex flex-col gap-1.5">
        <input
          type="text"
          className="h-7 rounded border border-border bg-background px-2 text-xs"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Job name"
        />
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="h-7 flex-1 rounded border border-border bg-background px-2 font-mono text-xs"
            value={newCron}
            onChange={(e) => setNewCron(e.target.value)}
            placeholder="0 9 * * *"
          />
          <Button
            size="sm"
            variant="default"
            className="h-7 text-[10px]"
            onClick={handleAddJob}
          >
            Add
          </Button>
        </div>
        {error && <div className="text-destructive text-[10px]">{error}</div>}
      </div>

      {/* Job list */}
      {jobs.length > 0 ? (
        <div className="flex flex-col gap-1">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center justify-between rounded border border-border/40 bg-muted/20 px-2 py-1"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`h-3 w-3 rounded-full border ${job.enabled ? "bg-green-500 border-green-600" : "bg-muted border-border"}`}
                  onClick={() => handleToggle(job.id, !job.enabled)}
                  title={job.enabled ? "Disable" : "Enable"}
                />
                <div className="flex flex-col">
                  <span className="text-[10px] font-medium">{job.name}</span>
                  <span className="font-mono text-muted-foreground text-[9px]">
                    {job.cron_expression}
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 w-5 p-0 text-[10px] text-muted-foreground"
                onClick={() => handleRemoveJob(job.id)}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground text-[10px] italic">
          No scheduled jobs
        </div>
      )}

      {/* Recent triggers */}
      {recentTriggers.length > 0 && (
        <div>
          <h4 className="mb-1 text-muted-foreground text-[10px] uppercase tracking-wider">
            Recent Triggers
          </h4>
          <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
            {recentTriggers.map((t, i) => (
              <div
                key={i}
                className="rounded border border-border/40 bg-muted/10 px-2 py-1"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px]">{t.name}</span>
                  <span className="text-muted-foreground text-[9px]">
                    {t.fired_at.slice(11, 19)}
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
