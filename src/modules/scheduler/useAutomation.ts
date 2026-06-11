import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export type ScheduleJob = {
  id: string;
  name: string;
  cronExpression: string;
  enabled: boolean;
  prompt?: string;
  agentSlug?: string;
  lastRun?: string;
  nextRun?: string;
};

export function useAutomation() {
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<ScheduleJob[]>("schedule_list_jobs");
      setJobs(list);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addJob = useCallback(
    async (
      name: string,
      cronExpression: string,
      prompt?: string,
      agentSlug?: string,
    ) => {
      const job = await invoke<ScheduleJob>("schedule_add_job", {
        name,
        cronExpression,
        prompt,
        agentSlug,
      });
      await refresh();
      return job;
    },
    [refresh],
  );

  const removeJob = useCallback(
    async (jobId: string) => {
      await invoke("schedule_remove_job", { jobId });
      await refresh();
    },
    [refresh],
  );

  const toggleJob = useCallback(
    async (jobId: string, enabled: boolean) => {
      await invoke("schedule_toggle_job", { jobId, enabled });
      await refresh();
    },
    [refresh],
  );

  const startDaemon = useCallback(async () => {
    await invoke("schedule_start_daemon");
  }, []);

  const stopDaemon = useCallback(async () => {
    await invoke("schedule_stop_daemon");
  }, []);

  return {
    jobs,
    loading,
    addJob,
    removeJob,
    toggleJob,
    startDaemon,
    stopDaemon,
    refresh,
  };
}
