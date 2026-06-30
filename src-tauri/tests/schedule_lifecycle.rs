#![cfg(feature = "openclicky")]

use chrono::Timelike;

mod helpers {
    use serde::{Deserialize, Serialize};

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

    pub fn roundtrip(job: &ScheduleJob) -> ScheduleJob {
        let json = serde_json::to_string(job).unwrap();
        serde_json::from_str(&json).unwrap()
    }
}

#[test]
fn schedule_job_camel_case_serialization() {
    let job = helpers::ScheduleJob {
        id: "test-1".to_string(),
        name: "Test Job".to_string(),
        cron_expression: "0 * * * * *".to_string(),
        enabled: true,
        prompt: Some("Say hello".to_string()),
        agent_slug: Some("code-reviewer".to_string()),
        last_run: None,
        next_run: None,
    };

    let json = serde_json::to_string(&job).unwrap();
    assert!(json.contains("\"cronExpression\""));
    assert!(json.contains("\"agentSlug\""));
    assert!(!json.contains("cron_expression"));
    assert!(!json.contains("agent_slug"));
}

#[test]
fn schedule_job_roundtrip_preserves_fields() {
    let job = helpers::ScheduleJob {
        id: "test-2".to_string(),
        name: "Every Minute".to_string(),
        cron_expression: "* * * * *".to_string(),
        enabled: false,
        prompt: None,
        agent_slug: None,
        last_run: Some("2025-01-01T00:00:00Z".to_string()),
        next_run: Some("2025-01-01T00:01:00Z".to_string()),
    };

    let restored = helpers::roundtrip(&job);
    assert_eq!(restored.id, job.id);
    assert_eq!(restored.name, job.name);
    assert_eq!(restored.cron_expression, job.cron_expression);
    assert_eq!(restored.enabled, job.enabled);
    assert_eq!(restored.last_run, job.last_run);
    assert_eq!(restored.next_run, job.next_run);
}

#[test]
fn schedule_job_optional_fields_default_to_none() {
    let json = r#"{
        "id": "test-3",
        "name": "Minimal",
        "cronExpression": "0 0 * * *",
        "enabled": true
    }"#;

    let job: helpers::ScheduleJob = serde_json::from_str(json).unwrap();
    assert_eq!(job.prompt, None);
    assert_eq!(job.agent_slug, None);
    assert_eq!(job.last_run, None);
    assert_eq!(job.next_run, None);
}

#[test]
fn cron_expression_every_minute_matches() {
    use std::str::FromStr;
    let schedule = cron::Schedule::from_str("0 * * * * *").unwrap();
    let now = chrono::Local::now();
    let next = schedule.upcoming(chrono::Local).next();
    assert!(next.is_some());
    let diff = (next.unwrap() - now).num_seconds();
    assert!((0..=60).contains(&diff));
}

#[test]
fn cron_expression_specific_hour_matches() {
    use std::str::FromStr;
    let schedule = cron::Schedule::from_str("0 0 9 * * *").unwrap();
    let upcoming: Vec<_> = schedule.upcoming(chrono::Local).take(3).collect();
    assert_eq!(upcoming.len(), 3);
    for time in &upcoming {
        assert_eq!(time.time().minute(), 0);
        assert_eq!(time.time().hour(), 9);
    }
}
