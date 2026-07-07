/**
 * Pi SDK Webview Bridge
 *
 * Enables the Pi SDK to run entirely in the Tauri webview
 * instead of requiring a Node.js sidecar process.
 *
 * Usage:
 *   import { createTauriAgent, subscribeToAgent } from "@/modules/pi/bridge";
 *
 * This eliminates the 583 MB sidecar (Node.js + npm packages).
 */

export { createTauriAgent, subscribeToAgent } from "./pi-session";
export type { TauriAgentOptions } from "./pi-session";
export { piBridgeTools } from "./pi-tools";
export { piFetch, installProxiedFetch, uninstallProxiedFetch } from "./pi-http";
export { piEnv } from "./pi-env";
export { resolveSkillFiles, buildSystemPromptWithSkills } from "./pi-skills";
