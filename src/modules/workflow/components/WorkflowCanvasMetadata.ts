import type {
  WorkflowDocument,
  WorkflowNode,
  WorkflowRuntimeStatus,
} from "../lib/schema";
import { safeFilename } from "./WorkflowCanvasArtifacts";

export function hasRuntimeStatus(
  document: WorkflowDocument,
  status: WorkflowRuntimeStatus,
): boolean {
  return document.nodes.some((node) => node.runtimeState.status === status);
}

export function nextNodePosition(document: WorkflowDocument) {
  return {
    x: 120 + document.nodes.length * 36,
    y: 80 + document.nodes.length * 24,
  };
}

export function workflowJsonFilename(document: WorkflowDocument): string {
  return `${safeFilename(document.title || document.id)}.workflow.json`;
}

export function pathBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function isApprovedRuntimeNode(node: WorkflowNode): boolean {
  return (
    node.type === "agent" ||
    node.type === "browserAutomation" ||
    node.type === "fileOperation" ||
    node.type === "shellCommand"
  );
}

export function approvedRunLabel(node: WorkflowNode): string {
  if (node.type === "agent") return "Agent run";
  if (node.type === "browserAutomation") return "Browser automation";
  if (node.type === "fileOperation") return "File operation";
  return "Shell command";
}

export function nodeSubtitle(node: WorkflowNode): string {
  if (node.type === "textPrompt") return "Text source";
  if (node.type === "imageGeneration") return "Image generation";
  if (node.type === "videoGeneration") return "Video generation";
  if (node.type === "audioGeneration") return "Audio generation";
  if (node.type === "terminal") return "Terax xterm WebGL";
  if (node.type === "shellCommand") return "Approved command";
  if (node.type === "agent") return "Agent workflow";
  if (node.type === "httpRequest") return "HTTP automation";
  if (node.type === "fileOperation") return "Approved file automation";
  if (node.type === "browserAutomation") return "Approved browser automation";
  return "Media output";
}
