use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleJob {
    pub id: String,
    pub name: String,
    pub cron_expression: String,
    pub enabled: bool,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub agent_slug: Option<String>,
    #[serde(default)]
    pub last_run: Option<String>,
    #[serde(default)]
    pub next_run: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleTrigger {
    pub job_id: String,
    pub name: String,
    pub fired_at: String,
}

pub struct ScheduleState {
    jobs: Arc<RwLock<HashMap<String, ScheduleJob>>>,
    shutdown: Arc<RwLock<Option<tokio::sync::oneshot::Sender<()>>>>,
    loaded: Arc<RwLock<bool>>,
}

impl Default for ScheduleState {
    fn default() -> Self {
        Self {
            jobs: Arc::new(RwLock::new(HashMap::new())),
            shutdown: Arc::new(RwLock::new(None)),
            loaded: Arc::new(RwLock::new(false)),
        }
    }
}

fn schedules_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir: {e}"))?;
    Ok(dir.join("schedules.json"))
}

async fn persist_jobs(app: &AppHandle, jobs: &HashMap<String, ScheduleJob>) {
    if let Ok(path) = schedules_path(app) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let list: Vec<&ScheduleJob> = jobs.values().collect();
        if let Ok(json) = serde_json::to_string_pretty(&list) {
            let tmp = path.with_extension("json.tmp");
            if let Err(e) = std::fs::write(&tmp, &json) {
                log::warn!("schedule persist write failed: {e}");
                return;
            }
            if let Err(e) = std::fs::rename(&tmp, &path) {
                log::warn!("schedule persist rename failed: {e}");
            }
        }
    }
}

async fn load_jobs_from_disk(app: &AppHandle) -> HashMap<String, ScheduleJob> {
    let Ok(path) = schedules_path(app) else {
        return HashMap::new();
    };
    let Ok(data) = std::fs::read_to_string(&path) else {
        return HashMap::new();
    };
    let Ok(list) = serde_json::from_str::<Vec<ScheduleJob>>(&data) else {
        let backup = path.with_extension("json.corrupt");
        let _ = std::fs::rename(&path, &backup);
        log::warn!("schedule file corrupt, backed up to {:?}", backup);
        return HashMap::new();
    };
    list.into_iter().map(|j| (j.id.clone(), j)).collect()
}

#[tauri::command]
pub async fn schedule_add_job(
    app: AppHandle,
    state: State<'_, ScheduleState>,
    name: String,
    cron_expression: String,
    prompt: Option<String>,
    agent_slug: Option<String>,
) -> Result<ScheduleJob, String> {
    let _schedule = cron::Schedule::from_str(&cron_expression)
        .map_err(|e| format!("Invalid cron expression: {e}"))?;

    let id = uuid::Uuid::new_v4().to_string();
    let job = ScheduleJob {
        id: id.clone(),
        name,
        cron_expression,
        enabled: true,
        prompt,
        agent_slug,
        last_run: None,
        next_run: None,
    };
    state.jobs.write().await.insert(id, job.clone());
    {
        let jobs = state.jobs.read().await;
        persist_jobs(&app, &jobs).await;
    }
    Ok(job)
}

#[tauri::command]
pub async fn schedule_remove_job(
    app: AppHandle,
    state: State<'_, ScheduleState>,
    job_id: String,
) -> Result<(), String> {
    state.jobs.write().await.remove(&job_id);
    {
        let jobs = state.jobs.read().await;
        persist_jobs(&app, &jobs).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn schedule_toggle_job(
    app: AppHandle,
    state: State<'_, ScheduleState>,
    job_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut jobs = state.jobs.write().await;
    if let Some(job) = jobs.get_mut(&job_id) {
        job.enabled = enabled;
        drop(jobs);
        let jobs = state.jobs.read().await;
        persist_jobs(&app, &jobs).await;
        Ok(())
    } else {
        Err(format!("Job {job_id} not found"))
    }
}

#[tauri::command]
pub async fn schedule_list_jobs(
    app: AppHandle,
    state: State<'_, ScheduleState>,
) -> Result<Vec<ScheduleJob>, String> {
    {
        let loaded = state.loaded.read().await;
        if !*loaded {
            drop(loaded);
            let disk_jobs = load_jobs_from_disk(&app).await;
            let mut jobs = state.jobs.write().await;
            *jobs = disk_jobs;
            *state.loaded.write().await = true;
        }
    }
    let jobs = state.jobs.read().await;
    Ok(jobs.values().cloned().collect())
}

#[tauri::command]
pub async fn schedule_start_daemon(
    app: AppHandle,
    state: State<'_, ScheduleState>,
) -> Result<(), String> {
    {
        let mut shutdown = state.shutdown.write().await;
        if let Some(tx) = shutdown.take() {
            let _ = tx.send(());
        }
    }
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let mut jobs_guard = state.jobs.write().await;
    {
        let loaded = state.loaded.read().await;
        if !*loaded {
            drop(loaded);
            *jobs_guard = load_jobs_from_disk(&app).await;
            *state.loaded.write().await = true;
        }
    }
    drop(jobs_guard);

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

                    let jobs_snapshot: Vec<ScheduleJob> = {
                        let jobs_guard = jobs.read().await;
                        jobs_guard.values().cloned().collect()
                    };

                    let jobs_count = jobs_snapshot.len();
                    for job in &jobs_snapshot {
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
                                if last_fired.len() > jobs_count + 10 {
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

#[tauri::command]
pub async fn schedule_stop_daemon(state: State<'_, ScheduleState>) -> Result<(), String> {
    let mut shutdown = state.shutdown.write().await;
    if let Some(tx) = shutdown.take() {
        let _ = tx.send(());
    }
    log::info!("schedule daemon stopped");
    Ok(())
}

pub async fn auto_start_if_needed(app: &AppHandle) {
    let state = app.state::<ScheduleState>();
    {
        let loaded = state.loaded.read().await;
        if !*loaded {
            drop(loaded);
            let mut jobs = state.jobs.write().await;
            *jobs = load_jobs_from_disk(app).await;
            *state.loaded.write().await = true;
        }
    }
    let has_enabled = state.jobs.read().await.values().any(|j| j.enabled);

    if has_enabled {
        if let Err(e) = schedule_start_daemon(app.clone(), state).await {
            log::warn!("schedule auto-start failed: {e}");
        }
    }
}
