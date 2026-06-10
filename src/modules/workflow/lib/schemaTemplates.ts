import type { WorkflowNode, WorkflowNodeType } from "./schema";

export type WorkflowNodeTemplate = Pick<
  WorkflowNode,
  "title" | "size" | "inputs" | "outputs" | "config" | "uiState"
>;

export function workflowNodeTemplate(
  type: WorkflowNodeType,
): WorkflowNodeTemplate {
  if (type === "textPrompt") {
    return {
      title: "Prompt",
      size: { width: 260, height: 150 },
      inputs: [],
      outputs: [{ id: "text", type: "text", label: "Text" }],
      config: { prompt: "A cinematic robot pianist in a neon studio" },
      uiState: {},
    };
  }
  if (type === "imageGeneration") {
    return {
      title: "Image Generation",
      size: { width: 300, height: 190 },
      inputs: [{ id: "prompt", type: "text", label: "Prompt" }],
      outputs: [{ id: "image", type: "image", label: "Image" }],
      config: { provider: "placeholder", model: "image" },
      uiState: {},
    };
  }
  if (type === "videoGeneration") {
    return {
      title: "Video Generation",
      size: { width: 320, height: 190 },
      inputs: [
        { id: "prompt", type: "text", label: "Prompt" },
        { id: "image", type: "image", label: "Image" },
      ],
      outputs: [{ id: "video", type: "video", label: "Video" }],
      config: { provider: "placeholder", model: "video" },
      uiState: {},
    };
  }
  if (type === "audioGeneration") {
    return {
      title: "Audio Generation",
      size: { width: 300, height: 170 },
      inputs: [{ id: "prompt", type: "text", label: "Prompt" }],
      outputs: [{ id: "audio", type: "audio", label: "Audio" }],
      config: { provider: "local", model: "audio" },
      uiState: {},
    };
  }
  if (type === "output") {
    return {
      title: "Output",
      size: { width: 260, height: 170 },
      inputs: [
        { id: "media", type: "image", label: "Media" },
        { id: "audio", type: "audio", label: "Audio" },
        { id: "video", type: "video", label: "Video" },
      ],
      outputs: [],
      config: {},
      uiState: {},
    };
  }
  if (type === "terminal") {
    return {
      title: "Terminal",
      size: { width: 420, height: 240 },
      inputs: [{ id: "command", type: "command", label: "Command" }],
      outputs: [{ id: "terminal", type: "terminal", label: "Session" }],
      config: { mode: "interactive" },
      uiState: { collapsed: true },
    };
  }
  if (type === "shellCommand") {
    return {
      title: "Shell Command",
      size: { width: 300, height: 170 },
      inputs: [{ id: "command", type: "command", label: "Command" }],
      outputs: [{ id: "stdout", type: "text", label: "Stdout" }],
      config: { command: "", cwd: "", requiresApproval: true, timeoutSecs: 30 },
      uiState: {},
    };
  }
  if (type === "httpRequest") {
    return {
      title: "HTTP Request",
      size: { width: 320, height: 200 },
      inputs: [
        { id: "body", type: "json", label: "JSON body" },
        { id: "text", type: "text", label: "Text body" },
      ],
      outputs: [{ id: "response", type: "json", label: "Response" }],
      config: { method: "GET", url: "", headers: "" },
      uiState: {},
    };
  }
  if (type === "fileOperation") {
    return {
      title: "File Operation",
      size: { width: 320, height: 190 },
      inputs: [
        { id: "content", type: "text", label: "Content" },
        { id: "file", type: "file", label: "File" },
      ],
      outputs: [{ id: "result", type: "file", label: "Result" }],
      config: { operation: "read", path: "", requiresApproval: true },
      uiState: {},
    };
  }
  if (type === "browserAutomation") {
    return {
      title: "Browser Automation",
      size: { width: 320, height: 210 },
      inputs: [{ id: "instructions", type: "text", label: "Instructions" }],
      outputs: [{ id: "result", type: "json", label: "Result" }],
      config: { url: "", instructions: "", requiresApproval: true },
      uiState: {},
    };
  }
  if (type === "delay") {
    return {
      title: "Delay",
      size: { width: 240, height: 140 },
      inputs: [],
      outputs: [{ id: "trigger", type: "text", label: "Trigger" }],
      config: { seconds: 0 },
      uiState: {},
    };
  }
  if (type === "webhook") {
    return {
      title: "Webhook",
      size: { width: 280, height: 160 },
      inputs: [],
      outputs: [
        { id: "body", type: "json", label: "Body" },
        { id: "headers", type: "json", label: "Headers" },
        { id: "trigger", type: "text", label: "Trigger" },
      ],
      config: { path: "/", method: "POST" },
      uiState: {},
    };
  }
  if (type === "schedule") {
    return {
      title: "Schedule",
      size: { width: 280, height: 150 },
      inputs: [],
      outputs: [{ id: "trigger", type: "text", label: "Trigger" }],
      config: { cron: "" },
      uiState: {},
    };
  }
  if (type === "if") {
    return {
      title: "If",
      size: { width: 260, height: 180 },
      inputs: [{ id: "input", type: "text", label: "Input" }],
      outputs: [
        { id: "true", type: "text", label: "True" },
        { id: "false", type: "text", label: "False" },
      ],
      config: { operator: "equals", value: "" },
      uiState: {},
    };
  }
  if (type === "switch") {
    return {
      title: "Switch",
      size: { width: 300, height: 200 },
      inputs: [{ id: "input", type: "text", label: "Input" }],
      outputs: [
        { id: "case_1", type: "text", label: "Case 1" },
        { id: "case_2", type: "text", label: "Case 2" },
        { id: "default", type: "text", label: "Default" },
      ],
      config: { operator: "equals", cases: "" },
      uiState: {},
    };
  }
  if (type === "merge") {
    return {
      title: "Merge",
      size: { width: 260, height: 160 },
      inputs: [
        { id: "text_a", type: "text", label: "Text A" },
        { id: "text_b", type: "text", label: "Text B" },
      ],
      outputs: [{ id: "text", type: "text", label: "Result" }],
      config: { separator: "\n" },
      uiState: {},
    };
  }
  if (type === "setVariable") {
    return {
      title: "Set Variable",
      size: { width: 260, height: 150 },
      inputs: [{ id: "text", type: "text", label: "Input" }],
      outputs: [{ id: "result", type: "text", label: "Result" }],
      config: { variableName: "" },
      uiState: {},
    };
  }
  if (type === "getVariable") {
    return {
      title: "Get Variable",
      size: { width: 260, height: 150 },
      inputs: [{ id: "trigger", type: "text", label: "Trigger" }],
      outputs: [{ id: "result", type: "text", label: "Result" }],
      config: { variableName: "" },
      uiState: {},
    };
  }
  if (type === "textTransform") {
    return {
      title: "Text Transform",
      size: { width: 280, height: 160 },
      inputs: [{ id: "text", type: "text", label: "Input" }],
      outputs: [{ id: "text", type: "text", label: "Result" }],
      config: { template: "{{input}}" },
      uiState: {},
    };
  }
  return {
    title: "Agent",
    size: { width: 300, height: 180 },
    inputs: [{ id: "prompt", type: "text", label: "Prompt" }],
    outputs: [{ id: "result", type: "agent", label: "Result" }],
    config: { mode: "agent" },
    uiState: {},
  };
}
