use std::future::Future;
use std::pin::Pin;

use serde_json::{json, Value};

pub trait McpToolProvider: Send + Sync {
    fn tools(&self) -> Vec<McpExposedTool>;
    fn call(&self, name: &str, params: Value) -> Pin<Box<dyn Future<Output = Result<Value, String>> + Send + '_>>;
}

#[derive(Debug, Clone)]
pub struct McpExposedTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

pub fn builtin_tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "screenshot",
            "description": "Capture a screenshot of the user's screen",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "focused_only": { "type": "boolean", "description": "Capture only the display containing the main window" }
                }
            }
        }),
        json!({
            "name": "speak",
            "description": "Read text aloud using text-to-speech",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "Text to speak" },
                    "provider": { "type": "string", "description": "TTS provider: cartesia or avspeech" }
                },
                "required": ["text"]
            }
        }),
        json!({
            "name": "run_command",
            "description": "Run a shell command and return its output",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Shell command to run" }
                },
                "required": ["command"]
            }
        }),
        json!({
            "name": "read_file",
            "description": "Read the contents of a file",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute file path" }
                },
                "required": ["path"]
            }
        }),
        json!({
            "name": "list_directory",
            "description": "List files in a directory",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute directory path" }
                },
                "required": ["path"]
            }
        }),
    ]
}

pub fn call_builtin_tool(name: &str, arguments: Value) -> Result<String, String> {
    match name {
        "screenshot" => Err("screenshot requires a running Tauri app context".to_string()),
        "speak" => Err("speak requires a running Tauri app context".to_string()),
        "run_command" => {
            let command = arguments
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or("missing 'command' parameter")?;
            let output = std::process::Command::new("sh")
                .arg("-c")
                .arg(command)
                .output()
                .map_err(|e| format!("command failed: {e}"))?;
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            Ok(format!("{stdout}{stderr}"))
        }
        "read_file" => {
            let path = arguments
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("missing 'path' parameter")?;
            std::fs::read_to_string(path).map_err(|e| format!("read failed: {e}"))
        }
        "list_directory" => {
            let path = arguments
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("missing 'path' parameter")?;
            let entries: Vec<String> = std::fs::read_dir(path)
                .map_err(|e| format!("list failed: {e}"))?
                .flatten()
                .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
                .collect();
            Ok(entries.join("\n"))
        }
        _ => Err(format!("unknown tool: {name}")),
    }
}
