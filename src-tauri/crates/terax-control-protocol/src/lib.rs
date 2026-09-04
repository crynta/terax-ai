use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;
pub const METHOD_PING: &str = "ping";
pub const METHOD_CAPABILITIES: &str = "capabilities";
pub const METHOD_IDENTIFY: &str = "identify";
pub const METHOD_OPEN: &str = "open";
pub const SERVER_RESPONSE_ID: &str = "server";
pub const METHODS: &[&str] = &[
    METHOD_PING,
    METHOD_CAPABILITIES,
    METHOD_IDENTIFY,
    METHOD_OPEN,
];

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct CallerContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<u32>,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
pub struct ControlRequest {
    pub protocol: u16,
    pub id: String,
    pub token: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default)]
    pub caller: CallerContext,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ControlError {
    pub code: String,
    pub message: String,
}

impl ControlError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ControlResponse {
    pub protocol: u16,
    pub id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ControlError>,
}

impl ControlResponse {
    pub fn success(id: impl Into<String>, result: Value) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            id: id.into(),
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(
        id: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            id: id.into(),
            ok: false,
            result: None,
            error: Some(ControlError::new(code, message)),
        }
    }
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
pub struct ControlDescriptor {
    pub protocol: u16,
    pub address: String,
    pub token: String,
    pub pid: u32,
    pub app_version: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FrontendRequest {
    pub id: String,
    pub method: String,
    pub params: Value,
    pub caller: CallerContext,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FrontendResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ControlError>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct OpenParams {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
    #[serde(default = "default_focus")]
    pub focus: bool,
}

fn default_focus() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_round_trips_without_caller_context() {
        let raw = json!({
            "protocol": PROTOCOL_VERSION,
            "id": "42",
            "token": "secret",
            "method": METHOD_PING,
            "params": {}
        });
        let request: ControlRequest = serde_json::from_value(raw).expect("deserialize request");
        assert_eq!(request.caller, CallerContext::default());
        assert_eq!(request.method, METHOD_PING);
    }

    #[test]
    fn response_shapes_are_unambiguous() {
        let success = ControlResponse::success("1", json!({ "pong": true }));
        assert!(success.ok);
        assert!(success.result.is_some());
        assert!(success.error.is_none());

        let failure = ControlResponse::failure("2", "invalid_request", "bad request");
        assert!(!failure.ok);
        assert!(failure.result.is_none());
        assert_eq!(failure.error.expect("error").code, "invalid_request");
    }

    #[test]
    fn open_defaults_to_focusing_the_target() {
        let params: OpenParams =
            serde_json::from_value(json!({ "path": "/tmp/a" })).expect("deserialize open params");
        assert!(params.focus);
    }
}
