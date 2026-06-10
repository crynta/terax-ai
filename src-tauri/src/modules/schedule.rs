use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;
use tracing::instrument;

/// A scheduled job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleJob {
    pub id: String,
    pub name: String,
    pub cron_expression: String,
    pub enabled: bool,
}

/// Trigger payload delivered to the frontend when a schedule fires.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleTrigger {
    pub job_id: String,
    pub name: String,
    pub fired_at: String,
}

/// Active scheduler state.
pub struct ScheduleState {
    jobs: Arc<RwLock<HashMap<String, ScheduleJob>>>,
    shutdown: Arc<RwLock<Option<tokio::sync::oneshot::Sender<()>>>>,
}

impl Default for ScheduleState {
    fn default() -> Self {
        Self {
            jobs: Arc::new(RwLock::new(HashMap::new())),
            shutdown: Arc::new(RwLock::new(None)),
        }
    }
}

/// Add or update a scheduled job.
#[tauri::command]
#[instrument(skip(state), fields(name = %name, cron_expression = %cron_expression))]
pub async fn schedule_add_job(
    state: State<'_, ScheduleState>,
    name: String,
    cron_expression: String,
) -> Result<ScheduleJob, String> {
    // Validate cron expression by parsing it
    let _schedule = cron::Schedule::from_str(&cron_expression)
        .map_err(|e| format!("Invalid cron expression: {e}"))?;

    let id = uuid::Uuid::new_v4().to_string();
    let job = ScheduleJob {
        id: id.clone(),
        name,
        cron_expression,
        enabled: true,
    };
    state.jobs.write().await.insert(id, job.clone());
    Ok(job)
}

/// Remove a scheduled job.
#[tauri::command]
#[instrument(skip(state), fields(job_id = %job_id))]
pub async fn schedule_remove_job(
    state: State<'_, ScheduleState>,
    job_id: String,
) -> Result<(), String> {
    state.jobs.write().await.remove(&job_id);
    Ok(())
}

/// Enable or disable a job.
#[tauri::command]
#[instrument(skip(state), fields(job_id = %job_id, enabled = %enabled))]
pub async fn schedule_toggle_job(
    state: State<'_, ScheduleState>,
    job_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut jobs = state.jobs.write().await;
    if let Some(job) = jobs.get_mut(&job_id) {
        job.enabled = enabled;
        Ok(())
    } else {
        Err(format!("Job {job_id} not found"))
    }
}

/// List all scheduled jobs.
#[tauri::command]
#[instrument(skip(state))]
pub async fn schedule_list_jobs(
    state: State<'_, ScheduleState>,
) -> Result<Vec<ScheduleJob>, String> {
    Ok(state.jobs.read().await.values().cloned().collect())
}

/// Start the scheduler daemon. Checks every second and fires events for
/// jobs whose cron expression matches the current minute.
/// Uses chrono::Local for wall-clock time matching.
#[tauri::command]
#[instrument(skip(app, state))]
pub async fn schedule_start_daemon(
    app: AppHandle,
    state: State<'_, ScheduleState>,
) -> Result<(), String> {
    // Stop existing daemon
    {
        let mut shutdown = state.shutdown.write().await;
        if let Some(tx) = shutdown.take() {
            let _ = tx.send(());
        }
    }

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    *state.shutdown.write().await = Some(tx);

    let jobs = state.jobs.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        log::info!("schedule daemon started");
        let mut last_fired: HashMap<String, String> = HashMap::new();
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));

        tokio::pin!(rx);
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    let now = chrono::Local::now();
                    let minute_key = now.format("%Y-%m-%d %H:%M").to_string();

                    // Clone jobs while holding lock briefly, then release before processing
                    let jobs_snapshot: Vec<ScheduleJob> = {
                        let jobs_guard = jobs.read().await;
                        jobs_guard.values().cloned().collect()
                    };

                    for job in jobs_snapshot {
                        if !job.enabled { continue; }

                        if let Some(last) = last_fired.get(&job.id) {
                            if last == &minute_key { continue; }
                        }

                        if let Ok(schedule) = cron::Schedule::from_str(&job.cron_expression) {
                            let mut matches = false;
                            for next in schedule.upcoming(chrono::Local).take(3) {
                                let diff_secs = (next - now).num_seconds();
                                if (0..=2).contains(&diff_secs) {
                                    matches = true;
                                    break;
                                }
                            }
                            if matches {
                                log::info!("schedule firing: {} ({})", job.name, job.id);
                                let trigger = ScheduleTrigger {
                                    job_id: job.id.clone(),
                                    name: job.name.clone(),
                                    fired_at: now.to_rfc3339(),
                                };
                                let _ = app_handle.emit("workflow:schedule", &trigger);
                                last_fired.insert(job.id.clone(), minute_key.clone());
                                // Clean up stale entries using current job IDs
                                if last_fired.len() > jobs_snapshot.len() + 10 {
                                    let active: std::collections::HashSet<_> = jobs_snapshot.iter().map(|j| j.id.clone()).collect();
                                    last_fired.retain(|k, _| active.contains(k));
                                }
                            }
                        }
                    }
                }
                _ = &mut rx => {
                    log::info!("schedule daemon shutting down");
                    break;
                }
            }
        }
    });

    Ok(())
}

/// Stop the scheduler daemon.
#[tauri::command]
#[instrument(skip(state))]
pub async fn schedule_stop_daemon(state: State<'_, ScheduleState>) -> Result<(), String> {
    let mut shutdown = state.shutdown.write().await;
    if let Some(tx) = shutdown.take() {
        let _ = tx.send(());
    }
    log::info!("schedule daemon stopped");
    Ok(())
}
