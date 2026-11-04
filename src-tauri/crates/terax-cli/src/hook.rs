use std::ffi::OsString;
use std::io::{IsTerminal, Read, Write};
use std::process::ExitCode;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::Value;
use terax_control_protocol::hook::{
    decision_output, is_decision_event, trim_payload, AgentName, HookParams, HookResult,
    DEFAULT_DECISION_SECS, MAX_DECISION_SECS, MAX_PAYLOAD_BYTES, MAX_STDIN_BYTES,
    NO_DECISION_OUTPUT,
};
use terax_control_protocol::{
    CallerContext, ControlDescriptor, ControlRequest, METHOD_HOOK, PROTOCOL_VERSION,
};

use crate::{request_id, send_request, validate_endpoint, Timeouts};

const STDIN_DEADLINE: Duration = Duration::from_secs(2);
const OBSERVE_TIMEOUTS: Timeouts = Timeouts {
    connect: Duration::from_millis(1000),
    io: Duration::from_millis(2000),
};
/// Slack beyond the wait the server was told about, so the server's own
/// timeout answer arrives before the socket read gives up.
const DECISION_SLACK: Duration = Duration::from_secs(10);
const MAX_EVENT_NAME: usize = 64;

/// Terax context a hook inherits from the shell that started the agent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HookEnvironment {
    pub pane_id: u32,
    pub address: String,
    pub token: String,
    pub decision_secs: u32,
    pub wait_enabled: bool,
    pub debug: bool,
}

impl HookEnvironment {
    /// `None` when this process is not inside a Terax pane, which makes the
    /// hook inert in every other terminal.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Option<Self> {
        let pane_id = get("TERAX_PANE_ID")?.trim().parse::<u32>().ok()?;
        let address = get("TERAX_CONTROL_ADDR").filter(|value| !value.is_empty())?;
        let token = get("TERAX_CONTROL_TOKEN").filter(|value| !value.is_empty())?;
        let decision_secs = get("TERAX_HOOK_TIMEOUT")
            .and_then(|value| value.trim().parse::<u32>().ok())
            .map_or(DEFAULT_DECISION_SECS, |secs| {
                secs.clamp(1, MAX_DECISION_SECS)
            });
        Some(Self {
            pane_id,
            address,
            token,
            decision_secs,
            wait_enabled: get("TERAX_HOOK_WAIT").as_deref() != Some("0"),
            debug: get("TERAX_HOOK_DEBUG").is_some_and(|value| !value.is_empty() && value != "0"),
        })
    }
}

pub fn main(args: &[OsString]) -> ExitCode {
    let environment = HookEnvironment::from_lookup(|name| std::env::var(name).ok());
    let stdin: Box<dyn Read + Send> = if std::io::stdin().is_terminal() {
        Box::new(std::io::empty())
    } else {
        Box::new(std::io::stdin())
    };
    let mut stdout = std::io::stdout().lock();
    run(args, environment.as_ref(), stdin, &mut stdout);
    ExitCode::SUCCESS
}

/// Delivers one agent hook to Terax and prints what the agent expects on
/// stdout. Never fails the agent: every problem degrades to `{}`.
pub fn run(
    args: &[OsString],
    environment: Option<&HookEnvironment>,
    stdin: Box<dyn Read + Send>,
    out: &mut dyn Write,
) {
    let output = deliver(args, environment, stdin).unwrap_or_else(|reason| {
        if environment.is_some_and(|environment| environment.debug) {
            eprintln!("terax hook: {reason}");
        }
        NO_DECISION_OUTPUT.to_string()
    });
    let _ = writeln!(out, "{output}");
    let _ = out.flush();
}

fn deliver(
    args: &[OsString],
    environment: Option<&HookEnvironment>,
    stdin: Box<dyn Read + Send>,
) -> Result<String, String> {
    let environment = environment.ok_or("not inside a Terax pane")?;
    let (agent, event) = parse_args(args)?;

    let original = read_payload(stdin);
    let wait_secs = (environment.wait_enabled && is_decision_event(agent, &event))
        .then_some(environment.decision_secs);
    let params = HookParams {
        agent: agent.as_str().to_string(),
        event: event.clone(),
        payload: trim_payload(&original, MAX_PAYLOAD_BYTES),
        wait_secs,
    };

    let endpoint = validate_endpoint(
        ControlDescriptor {
            protocol: PROTOCOL_VERSION,
            address: environment.address.clone(),
            token: environment.token.clone(),
            pid: 0,
            app_version: String::new(),
        },
        false,
    )
    .map_err(|error| error.message)?;

    let request = ControlRequest {
        protocol: PROTOCOL_VERSION,
        id: request_id(),
        token: endpoint.token,
        method: METHOD_HOOK.to_string(),
        params: serde_json::to_value(&params).map_err(|error| error.to_string())?,
        caller: CallerContext {
            pane_id: Some(environment.pane_id),
        },
    };
    let timeouts = match wait_secs {
        Some(secs) => Timeouts {
            connect: OBSERVE_TIMEOUTS.connect,
            io: Duration::from_secs(u64::from(secs)) + DECISION_SLACK,
        },
        None => OBSERVE_TIMEOUTS,
    };
    let response =
        send_request(&endpoint.address, &request, timeouts).map_err(|error| error.message)?;
    if !response.ok {
        let reason = response
            .error
            .map_or_else(|| "rejected".to_string(), |error| error.code);
        return Err(format!("Terax rejected the hook: {reason}"));
    }
    let result: HookResult = serde_json::from_value(response.result.unwrap_or(Value::Null))
        .map_err(|error| format!("unreadable hook result: {error}"))?;
    Ok(result
        .decision
        .map(|decision| decision_output(agent, &event, &decision, &original).to_string())
        .unwrap_or_else(|| NO_DECISION_OUTPUT.to_string()))
}

fn parse_args(args: &[OsString]) -> Result<(AgentName, String), String> {
    let agent = args
        .first()
        .and_then(|value| value.to_str())
        .and_then(AgentName::parse)
        .ok_or("unknown agent")?;
    let event = args
        .get(1)
        .and_then(|value| value.to_str())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= MAX_EVENT_NAME
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
        })
        .ok_or("invalid event name")?;
    Ok((agent, event.to_string()))
}

/// The hook's JSON input, or `Null` when it is missing, malformed or too big.
/// Parsing starts as soon as a complete object has arrived, so an agent that
/// keeps stdin open does not stall the hook.
fn read_payload(mut stdin: Box<dyn Read + Send>) -> Value {
    let buffer = Arc::new(Mutex::new(Vec::<u8>::new()));
    let (done, finished) = mpsc::channel::<()>();
    let shared = Arc::clone(&buffer);
    let spawned = thread::Builder::new()
        .name("terax-hook-stdin".into())
        .spawn(move || {
            let mut chunk = [0u8; 16 * 1024];
            loop {
                let read = match stdin.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => read,
                };
                let mut bytes = shared.lock().unwrap_or_else(|poison| poison.into_inner());
                if bytes.len() + read > MAX_STDIN_BYTES {
                    break;
                }
                bytes.extend_from_slice(&chunk[..read]);
                if looks_complete(&bytes) {
                    break;
                }
            }
            let _ = done.send(());
        });
    if spawned.is_err() {
        return Value::Null;
    }
    let _ = finished.recv_timeout(STDIN_DEADLINE);
    let bytes = buffer.lock().unwrap_or_else(|poison| poison.into_inner());
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

fn looks_complete(bytes: &[u8]) -> bool {
    bytes
        .iter()
        .rposition(|byte| !byte.is_ascii_whitespace())
        .is_some_and(|last| bytes[last] == b'}' && serde_json::from_slice::<Value>(bytes).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Cursor;
    use std::time::Instant;

    fn lookup(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |name| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_string())
        }
    }

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn the_environment_requires_every_terax_variable() {
        let full: &[(&str, &str)] = &[
            ("TERAX_PANE_ID", "7"),
            ("TERAX_CONTROL_ADDR", "127.0.0.1:4000"),
            ("TERAX_CONTROL_TOKEN", "tok"),
        ];
        let environment = HookEnvironment::from_lookup(lookup(full)).unwrap();
        assert_eq!(environment.pane_id, 7);
        assert_eq!(environment.decision_secs, DEFAULT_DECISION_SECS);
        assert!(environment.wait_enabled);
        assert!(!environment.debug);

        for skip in 0..full.len() {
            let mut partial: Vec<(&'static str, &'static str)> = full.to_vec();
            partial.remove(skip);
            let partial: &'static [(&'static str, &'static str)] = Box::leak(partial.into());
            assert_eq!(
                HookEnvironment::from_lookup(lookup(partial)),
                None,
                "{skip}"
            );
        }
        assert_eq!(
            HookEnvironment::from_lookup(lookup(&[
                ("TERAX_PANE_ID", "x"),
                ("TERAX_CONTROL_ADDR", "a"),
                ("TERAX_CONTROL_TOKEN", "t"),
            ])),
            None
        );
    }

    #[test]
    fn decision_wait_is_configurable_and_clamped() {
        let with = |timeout: &'static str, wait: &'static str| {
            let pairs: &'static [(&'static str, &'static str)] = Box::leak(
                vec![
                    ("TERAX_PANE_ID", "1"),
                    ("TERAX_CONTROL_ADDR", "a"),
                    ("TERAX_CONTROL_TOKEN", "t"),
                    ("TERAX_HOOK_TIMEOUT", timeout),
                    ("TERAX_HOOK_WAIT", wait),
                    ("TERAX_HOOK_DEBUG", "1"),
                ]
                .into(),
            );
            HookEnvironment::from_lookup(lookup(pairs)).unwrap()
        };
        assert_eq!(with("30", "1").decision_secs, 30);
        assert_eq!(with("0", "1").decision_secs, 1);
        assert_eq!(with("999999", "1").decision_secs, MAX_DECISION_SECS);
        assert_eq!(with("abc", "1").decision_secs, DEFAULT_DECISION_SECS);
        assert!(!with("30", "0").wait_enabled);
        assert!(with("30", "1").debug);
    }

    #[test]
    fn arguments_are_validated_without_failing_loudly() {
        assert_eq!(
            parse_args(&args(&["claude", "Stop"])).unwrap(),
            (AgentName::Claude, "Stop".to_string())
        );
        assert!(parse_args(&args(&["nobody", "Stop"])).is_err());
        assert!(parse_args(&args(&["claude"])).is_err());
        assert!(parse_args(&args(&["claude", ""])).is_err());
        assert!(parse_args(&args(&["claude", "Stop;rm"])).is_err());
        assert!(parse_args(&args(&["claude", &"E".repeat(MAX_EVENT_NAME + 1)])).is_err());
    }

    #[test]
    fn outside_terax_the_hook_prints_an_empty_object_and_does_nothing() {
        let mut out = Vec::new();
        run(
            &args(&["claude", "Stop"]),
            None,
            Box::new(Cursor::new(b"{}".to_vec())),
            &mut out,
        );
        assert_eq!(String::from_utf8(out).unwrap(), "{}\n");
    }

    #[test]
    fn an_unreachable_app_never_fails_the_agent() {
        let environment = HookEnvironment {
            pane_id: 1,
            address: "127.0.0.1:1".into(),
            token: "a".repeat(64),
            decision_secs: 5,
            wait_enabled: true,
            debug: false,
        };
        let mut out = Vec::new();
        run(
            &args(&["claude", "PermissionRequest"]),
            Some(&environment),
            Box::new(Cursor::new(b"{}".to_vec())),
            &mut out,
        );
        assert_eq!(String::from_utf8(out).unwrap(), "{}\n");
    }

    #[test]
    fn payload_reading_handles_every_input_shape() {
        let read = |bytes: &[u8]| read_payload(Box::new(Cursor::new(bytes.to_vec())));
        assert_eq!(read(br#"{"a":1}"#), json!({ "a": 1 }));
        assert_eq!(read(b"  {\"a\":1}\n\n"), json!({ "a": 1 }));
        assert_eq!(read(b""), Value::Null);
        assert_eq!(read(b"not json"), Value::Null);
        assert_eq!(read(b"{\"a\":"), Value::Null);

        let oversized = format!("{{\"a\":\"{}\"}}", "x".repeat(MAX_STDIN_BYTES));
        assert_eq!(read(oversized.as_bytes()), Value::Null);
    }

    #[test]
    fn a_complete_object_does_not_wait_for_end_of_input() {
        struct Stalling(Cursor<Vec<u8>>);
        impl Read for Stalling {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                let read = self.0.read(buffer)?;
                if read == 0 {
                    thread::sleep(Duration::from_secs(30));
                }
                Ok(read)
            }
        }
        let started = Instant::now();
        let value = read_payload(Box::new(Stalling(Cursor::new(br#"{"a":1}"#.to_vec()))));
        assert_eq!(value, json!({ "a": 1 }));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn a_stalled_input_is_abandoned_at_the_deadline() {
        struct Never;
        impl Read for Never {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                thread::sleep(Duration::from_secs(30));
                Ok(0)
            }
        }
        let started = Instant::now();
        assert_eq!(read_payload(Box::new(Never)), Value::Null);
        assert!(started.elapsed() < STDIN_DEADLINE + Duration::from_secs(1));
    }
}
